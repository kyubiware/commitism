import Groq from "groq-sdk";
import { debug } from "../utils/debug.js";

const MAX_DIFF_CHARS = 20000;

const CONVENTIONAL_COMMIT_REGEX =
	/^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\(.+\))?!?: .+$/;

function stripContextLines(diff: string): string {
	return diff
		.split("\n")
		.filter((line) => !line.startsWith(" "))
		.join("\n");
}

function compressDiff(diff: string): string {
	// Tier 0 — Full diff
	if (diff.length <= MAX_DIFF_CHARS) {
		return diff;
	}

	// Tier 1 — Strip context lines
	let result = stripContextLines(diff);
	if (result.length <= MAX_DIFF_CHARS) {
		return result;
	}

	// Tier 2 — Per-hunk line cap
	const fileDiffs = result.split(/(?=diff --git)/).filter(Boolean);
	const cappedFiles = fileDiffs.map((fd) => {
		const parts = fd.split(/(?=\n@@)/);
		const cappedParts = parts.map((part, idx) => {
			if (idx === 0) return part; // Keep file header
			const lines = part.split("\n");
			const header = lines[0]; // @@ line
			const changedLines = lines.slice(1).filter((l) => l.startsWith("+") || l.startsWith("-"));
			const keptLines = changedLines.slice(0, 10);
			return [header, ...keptLines].join("\n");
		});
		return cappedParts.join("");
	});
	result = cappedFiles.join("");
	if (result.length <= MAX_DIFF_CHARS) {
		return result;
	}

	// Tier 3 — File summary
	const fileMatches = diff.match(/^diff --git a\/(.+) b\/(.+)$/gm) || [];
	const summary = fileMatches
		.map((f) => {
			const match = f.match(/^diff --git a\/(.+) b\/(.+)$/);
			return match && match[1] === match[2] ? `${match[1]} | changed` : "";
		})
		.filter(Boolean);
	return `Summary of changes:\n${summary.join("\n")}`;
}

function buildStatSummary(diff: string): string {
	const files: { name: string; adds: number; dels: number }[] = [];
	let currentFile = "";
	let adds = 0;
	let dels = 0;

	for (const line of diff.split("\n")) {
		const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
		if (match) {
			if (currentFile) files.push({ name: currentFile, adds, dels });
			currentFile = match[1];
			adds = 0;
			dels = 0;
		} else if (line.startsWith("+") && !line.startsWith("+++")) {
			adds++;
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			dels++;
		}
	}
	if (currentFile) files.push({ name: currentFile, adds, dels });

	const totalAdds = files.reduce((s, f) => s + f.adds, 0);
	const totalDels = files.reduce((s, f) => s + f.dels, 0);

	const lines = files.map((f) => ` ${f.name}  | +${f.adds} -${f.dels}`);
	lines.push(
		` ${files.length} files changed, ${totalAdds} insertions(+), ${totalDels} deletions(-)`,
	);

	return lines.join("\n");
}

function buildSystemPrompt(type?: string): string {
	let prompt =
		"You are a commit message generator. Follow the Conventional Commits specification.\n" +
		"Valid types: build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test.\n" +
		"Format: type(scope): description\n" +
		"Use imperative mood, lowercase, no trailing period.\n" +
		"Output ONLY the commit message, no markdown fences, no explanation.";

	if (type && type.trim().length > 0) {
		prompt += `\nYou MUST use type: ${type}`;
	}

	return prompt;
}

function buildUserPrompt(diff: string, hint?: string, statSummary?: string): string {
	const parts: string[] = [];
	if (hint) parts.push(`Context: ${hint}`);
	if (statSummary) parts.push(`Change summary:\n${statSummary}`);
	parts.push(`Generate a conventional commit for:\n\n${diff}`);
	return parts.join("\n\n");
}

function isValidConventionalCommit(message: string): boolean {
	return CONVENTIONAL_COMMIT_REGEX.test(message);
}

function enforceMaxLength(message: string, maxLength?: number): string {
	if (!maxLength || message.length <= maxLength) {
		return message;
	}
	return `${message.slice(0, maxLength - 3)}...`;
}

export async function generateCommitMessage(
	diff: string,
	options: {
		apiKey: string;
		model?: string;
		maxLength?: number;
		type?: string;
		timeout?: number;
		hint?: string;
	},
): Promise<string> {
	debug("generateCommitMessage: model=%s, maxLength=%s, type=%s, hint=%s",
		options.model ?? "default", options.maxLength ?? "default", options.type ?? "none", options.hint ?? "none");

	const client = new Groq({
		apiKey: options.apiKey,
		timeout: options.timeout ?? 60000,
	});

	const compressedDiff = compressDiff(diff);
	const statSummary = buildStatSummary(diff);
	const systemPrompt = buildSystemPrompt(options.type);
	const userPrompt = buildUserPrompt(compressedDiff, options.hint, statSummary);

	debug("Diff: %d chars → compressed to %d chars", diff.length, compressedDiff.length);
	debug("Stat summary:\n%s", statSummary);

	async function callAI(strictSystemPrompt?: string): Promise<string> {
		debug("Calling AI with model:", options.model ?? "openai/gpt-oss-20b");
		const completion = await client.chat.completions.create({
			messages: [
				{ role: "system", content: strictSystemPrompt ?? systemPrompt },
				{ role: "user", content: userPrompt },
			],
			model: options.model ?? "openai/gpt-oss-20b",
			temperature: 0.3,
			max_tokens: 300,
		});

		const content = completion.choices[0]?.message?.content;
		debug("AI response: %s", content?.slice(0, 200) ?? "(empty)");
		return content?.trim() ?? "";
	}

	try {
		let message = await callAI();

		if (!isValidConventionalCommit(message)) {
			debug("Message not valid conventional commit, retrying with strict prompt");
			const retryMessage = await callAI(
				"You MUST output ONLY a valid conventional commit message. " +
					"Format: type(scope): description. " +
					"If you output anything else your response will be rejected.\n" +
					"Valid types: build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test.",
			);
			if (isValidConventionalCommit(retryMessage)) {
				debug("Retry produced valid conventional commit");
				message = retryMessage;
			} else {
				debug("Retry also failed validation, using original message");
			}
		}

		const result = enforceMaxLength(message, options.maxLength);
		debug("Final message: %s", result);
		return result;
	} catch (error) {
		debug("AI error: %s", error instanceof Error ? error.message : String(error));
		if (error instanceof Groq.AuthenticationError) {
			throw new Error("Invalid GROQ_API_KEY. Run: cmint config set GROQ_API_KEY=<key>");
		}
		if (error instanceof Groq.RateLimitError) {
			throw new Error("Rate limited by Groq. Please wait and try again.");
		}
		if (error instanceof Groq.APIConnectionTimeoutError) {
			throw new Error("Request timed out. Check your network or try a smaller diff.");
		}
		if (error instanceof Groq.APIError) {
			throw new Error(`Groq API error: ${error.message}`);
		}
		throw new Error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
	}
}
