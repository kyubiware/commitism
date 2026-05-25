import Groq from "groq-sdk";
import { debug } from "../utils/debug.js";
import type { ChangedFile } from "./git.js";
import { getDefaultExcludes } from "./git.js";

export interface CommitGroup {
	name: string;
	description: string;
	files: string[];
}

export interface GroupingResult {
	groups: CommitGroup[];
	excluded: string[];
}

function mapGroqError(error: unknown): Error {
	if (error instanceof Groq.AuthenticationError) {
		return new Error("Invalid GROQ_API_KEY. Run: cmint config set GROQ_API_KEY=<key>");
	}
	if (error instanceof Groq.RateLimitError) {
		return new Error("Rate limited by Groq. Please wait and try again.");
	}
	if (error instanceof Groq.APIConnectionTimeoutError) {
		return new Error("Request timed out. Check your network and try again.");
	}
	if (error instanceof Groq.APIError) {
		return new Error(`Groq API error: ${error.message}`);
	}
	return new Error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
}

function matchesExcludePattern(filePath: string, pattern: string): boolean {
	if (pattern === filePath) return true;
	if (pattern.endsWith("/**")) {
		const prefix = pattern.slice(0, -3);
		return filePath === prefix || filePath.startsWith(`${prefix}/`);
	}
	if (pattern.startsWith("*.")) {
		const suffix = pattern.slice(1);
		return filePath.endsWith(suffix);
	}
	return false;
}

export function filterExcludedFiles(files: ChangedFile[]): {
	included: ChangedFile[];
	excluded: string[];
} {
	const patterns = getDefaultExcludes();
	const included: ChangedFile[] = [];
	const excluded: string[] = [];

	for (const file of files) {
		const isExcluded = patterns.some((pattern) => matchesExcludePattern(file.path, pattern));
		if (isExcluded) {
			excluded.push(file.path);
		} else {
			included.push(file);
		}
	}

	debug("filterExcludedFiles: %d included, %d excluded", included.length, excluded.length);
	return { included, excluded };
}

function statusIndicator(status: string): string {
	switch (status) {
		case "M":
			return "modified";
		case "A":
			return "added";
		case "D":
			return "deleted";
		case "R":
			return "renamed";
		case "C":
			return "copied";
		case "?":
			return "untracked";
		default:
			return "changed";
	}
}

export function buildFileSummary(files: ChangedFile[]): string {
	return files.map((f) => `${f.path} (${statusIndicator(f.status)})`).join("\n");
}

function buildGroupingSystemPrompt(): string {
	return [
		"You are analyzing changed files in a git repository. Group them into logical commits based on what changed and why. Each group should be a coherent unit of work.",
		"",
		"Rules:",
		"- Group by feature, fix, or concern (e.g., 'Frontend refactor', 'API changes', 'Test updates')",
		"- Keep related files together (e.g., a component + its test, a model + its migration)",
		"- Do not split a single logical change across multiple groups",
		"- If a file does not clearly belong to any group, include it anyway — do not omit files",
		"",
		"Output format: JSON array of objects with keys 'name', 'description', 'files'.",
		"name: short label (3-5 words)",
		"description: 1-2 sentences explaining what this group changes",
		"files: array of exact file paths from the input",
		"",
		"Output ONLY valid JSON. No markdown fences, no explanation.",
	].join("\n");
}

function buildGroupingUserPrompt(summary: string): string {
	return ["Group the following changed files into logical commits:", "", summary].join("\n");
}

function parseGroupingResponse(content: string): CommitGroup[] {
	const jsonText = content
		.replace(/^```json\s*/, "")
		.replace(/\s*```$/, "")
		.trim();
	const parsed = JSON.parse(jsonText) as unknown;

	if (!Array.isArray(parsed)) {
		throw new Error("AI response was not a JSON array");
	}

	const rawGroups: CommitGroup[] = [];
	for (const item of parsed) {
		if (
			typeof item === "object" &&
			item !== null &&
			"name" in item &&
			"description" in item &&
			"files" in item &&
			Array.isArray(item.files)
		) {
			rawGroups.push({
				name: String(item.name),
				description: String(item.description),
				files: item.files.filter((f: unknown) => typeof f === "string") as string[],
			});
		}
	}

	return rawGroups;
}

export async function generateGroups(
	files: ChangedFile[],
	apiKey: string,
	model?: string,
	timeout?: number,
): Promise<GroupingResult> {
	debug("generateGroups: %d files, model=%s", files.length, model ?? "default");

	const { included, excluded } = filterExcludedFiles(files);

	if (included.length === 0) {
		debug("generateGroups: no files to group after exclusion");
		return { groups: [], excluded };
	}

	const summary = buildFileSummary(included);
	const systemPrompt = buildGroupingSystemPrompt();
	const userPrompt = buildGroupingUserPrompt(summary);

	debug("File summary:\n%s", summary);
	debug("User prompt length: %d chars", userPrompt.length);

	const timeoutMs = timeout ?? 60000;
	const client = new Groq({ apiKey, timeout: timeoutMs });

	try {
		const completion = await client.chat.completions.create({
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			model: model ?? "openai/gpt-oss-20b",
			temperature: 0.3,
			max_tokens: 2048,
		});

		const rawContent = completion.choices[0]?.message?.content;
		const content = typeof rawContent === "string" ? rawContent.trim() : "";

		debug(
			"generateGroups response: choices=%d, finishReason=%s, contentLen=%d",
			completion.choices.length,
			completion.choices[0]?.finish_reason ?? "(none)",
			content.length,
		);
		debug("generateGroups raw content: %s", content.slice(0, 500) || "(empty)");

		if (!content) {
			throw new Error("AI returned an empty grouping response");
		}

		const rawGroups = parseGroupingResponse(content);

		debug("generateGroups: parsed %d raw groups", rawGroups.length);
		const validated = validateGroups(rawGroups, included);
		debug("generateGroups: %d validated groups", validated.length);

		return { groups: validated, excluded };
	} catch (error) {
		debug("generateGroups error: %s", error instanceof Error ? error.message : String(error));
		throw mapGroqError(error);
	}
}

export function validateGroups(groups: CommitGroup[], allFiles: ChangedFile[]): CommitGroup[] {
	const seen = new Set<string>();
	const validated: CommitGroup[] = [];

	for (const group of groups) {
		const uniqueFiles = group.files.filter((f) => {
			if (seen.has(f)) return false;
			seen.add(f);
			return true;
		});

		if (uniqueFiles.length > 0) {
			validated.push({
				name: group.name,
				description: group.description,
				files: uniqueFiles,
			});
		}
	}

	// Find files not in any group
	const ungrouped = allFiles.filter((f) => !seen.has(f.path));

	if (ungrouped.length > 0) {
		debug("validateGroups: %d ungrouped files added to 'Other changes'", ungrouped.length);
		validated.push({
			name: "Other changes",
			description: "Miscellaneous changes that did not fit into other groups",
			files: ungrouped.map((f) => f.path),
		});
	}

	return validated;
}
