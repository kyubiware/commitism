import Groq from "groq-sdk";
import { debug } from "../utils/debug.js";
import {
	buildStatSummary,
	compressDiff,
	deriveMessageFromReasoning,
	extractContentText,
	mapGroqError,
} from "./ai.js";

function buildReviewSystemPrompt(): string {
	return [
		"You are an expert code reviewer. Review the following staged git diff.",
		"",
		"Focus on finding:",
		"1. **Bugs** — logic errors, off-by-one, race conditions, null pointer risks",
		"2. **Security issues** — injection, exposure of secrets, missing validation, CSRF, XSS",
		"3. **Performance problems** — unnecessary work, large allocations in hot paths",
		"4. **Code quality** — readability, maintainability, error handling gaps",
		"5. **Edge cases** — missing boundary checks, empty states, error states",
		"",
		"For each issue found, use this format:",
		"- SEVERITY: [critical|major|minor|suggestion]",
		"- LOCATION: <file-path>:<line-number>",
		"- ISSUE: <description>",
		"- FIX: <suggested resolution>",
		"",
		"Separate issues with a blank line.",
		"",
		"If you find NO issues at all, respond with exactly: NO_ISSUES_FOUND",
		"",
		"Be thorough but practical. Only flag real problems — not style preferences or nitpicks.",
	].join("\n");
}

function buildReviewPrompt(diff: string, files: string[], statSummary: string): string {
	const parts: string[] = [];
	parts.push(`Review the following staged changes (${files.length} files):`);
	parts.push("");
	parts.push(statSummary);
	parts.push("");
	parts.push("```diff");
	parts.push(diff);
	parts.push("```");
	return parts.join("\n");
}

export async function generateCodeReview(
	diff: string,
	files: string[],
	options: {
		apiKey: string;
		model?: string;
		timeout?: number;
	},
): Promise<string> {
	debug("generateCodeReview: model=%s, files=%d", options.model ?? "default", files.length);
	const timeoutMs = options.timeout ?? 60000;
	const client = new Groq({ apiKey: options.apiKey, timeout: timeoutMs });
	const compressedDiff = compressDiff(diff);
	const statSummary = buildStatSummary(diff);
	const systemPrompt = buildReviewSystemPrompt();
	const userPrompt = buildReviewPrompt(compressedDiff, files, statSummary);

	debug(
		"Code review: %d chars → %d chars, system=%d chars, user=%d chars",
		diff.length,
		compressedDiff.length,
		systemPrompt.length,
		userPrompt.length,
	);

	try {
		const completion = await client.chat.completions.create({
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			model: options.model ?? "openai/gpt-oss-20b",
			temperature: 0.3,
			max_tokens: 4096,
		});

		const rawContent = completion.choices[0]?.message?.content;
		const content = extractContentText(rawContent);
		debug(
			"generateCodeReview response: choices=%d, finishReason=%s, contentLen=%d",
			completion.choices.length,
			completion.choices[0]?.finish_reason ?? "(none)",
			content.length,
		);

		if (!content) {
			const reasoning = completion.choices[0]?.message?.reasoning;
			if (reasoning) {
				const derived = deriveMessageFromReasoning(reasoning);
				if (derived) {
					debug("generateCodeReview: derived from reasoning");
					return derived;
				}
			}
			return "NO_ISSUES_FOUND";
		}

		return content;
	} catch (error) {
		debug("generateCodeReview error: %s", error instanceof Error ? error.message : String(error));
		throw mapGroqError(error);
	}
}
