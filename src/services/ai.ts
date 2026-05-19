import Groq from "groq-sdk";

const CONVENTIONAL_COMMIT_REGEX =
	/^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\(.+\))?!?: .+$/;

function compressDiff(diff: string): string {
	if (diff.length <= 40000) {
		return diff;
	}

	// Truncate lines longer than 256 chars
	let result = diff
		.split("\n")
		.map((line) => (line.length > 256 ? `${line.slice(0, 256)}...` : line))
		.join("\n");

	if (result.length <= 40000) {
		return result;
	}

	// Hunk truncation: split by file, sort by hunk count, truncate hunks
	const fileDiffs = result.split(/(?=diff --git)/).filter(Boolean);
	const files = fileDiffs.map((fd) => ({
		diff: fd,
		parts: fd.split(/(?=\n@@)/),
	}));

	while (result.length > 40000) {
		files.sort((a, b) => b.parts.length - a.parts.length);
		const longest = files[0];
		if (!longest || longest.parts.length <= 1) {
			break;
		}
		longest.parts.pop();
		longest.diff = longest.parts.join("");
		result = files.map((f) => f.diff).join("");
	}

	if (result.length <= 40000) {
		return result;
	}

	// Numstat fallback
	const fileMatches = result.match(/^diff --git a\/(.+) b\/(.+)$/gm) || [];
	const summary = fileMatches
		.map((f) => {
			const match = f.match(/^diff --git a\/(.+) b\/(.+)$/);
			return match && match[1] === match[2] ? `${match[1]} | changed` : "";
		})
		.filter(Boolean);
	return `Summary of changes:\n${summary.join("\n")}`;
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

function buildUserPrompt(diff: string, hint?: string): string {
	const prefix = hint ? `Context: ${hint}\n\n` : "";
	return `${prefix}Generate a conventional commit for:\n\n${diff}`;
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
	const client = new Groq({
		apiKey: options.apiKey,
		timeout: options.timeout ?? 60000,
	});

	const compressedDiff = compressDiff(diff);
	const systemPrompt = buildSystemPrompt(options.type);
	const userPrompt = buildUserPrompt(compressedDiff, options.hint);

	async function callAI(strictSystemPrompt?: string): Promise<string> {
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
		return content?.trim() ?? "";
	}

	try {
		let message = await callAI();

		if (!isValidConventionalCommit(message)) {
			const retryMessage = await callAI(
				"You MUST output ONLY a valid conventional commit message. " +
					"Format: type(scope): description. " +
					"If you output anything else your response will be rejected.\n" +
					"Valid types: build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test.",
			);
			if (isValidConventionalCommit(retryMessage)) {
				message = retryMessage;
			}
		}

		return enforceMaxLength(message, options.maxLength);
	} catch (error) {
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
