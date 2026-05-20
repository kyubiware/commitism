import { debug } from "../utils/debug.js";

export interface HookError {
	tool: string;
	message: string;
	raw: string;
}

/**
 * Parse git hook error output into structured, human-readable errors.
 * Handles output from lint-staged, biome, eslint, tsc, vitest, jest.
 */
export function parseHookErrors(stderr: string): HookError[] {
	if (!stderr) return [];

	debug("parseHookErrors: stderr length=%d", stderr.length);
	const errors: HookError[] = [];

	// Detect lint-staged task failures
	if (stderr.includes("lint-staged") || stderr.includes("[FAILED]")) {
		errors.push(...parseLintStagedErrors(stderr));
	}

	// Detect biome errors
	if (stderr.includes("biome") || stderr.includes("Biome")) {
		errors.push(...parseBiomeErrors(stderr));
	}

	// Detect TypeScript errors
	if (stderr.includes("error TS") || stderr.includes("tsc")) {
		errors.push(...parseTscErrors(stderr));
	}

	// Detect vitest/jest test failures
	if (
		stderr.includes("vitest") ||
		stderr.includes("jest") ||
		stderr.includes("FAIL") ||
		stderr.includes("test failed")
	) {
		errors.push(...parseTestErrors(stderr));
	}

	// Detect ESLint errors
	if (stderr.includes("eslint") || stderr.includes("ESLint")) {
		errors.push(...parseEslintErrors(stderr));
	}

	// Fallback: if nothing parsed, return the raw output
	if (errors.length === 0) {
		debug("parseHookErrors: no patterns matched, using raw fallback");
		errors.push({
			tool: "git hooks",
			message: stderr.trim(),
			raw: stderr,
		});
	}

	debug("parseHookErrors: found %d errors", errors.length);
	return errors;
}

function parseLintStagedErrors(output: string): HookError[] {
	const errors: HookError[] = [];
	for (const match of output.matchAll(/\[FAILED\]\s+(.+?)\s+\[FAILED\]/g)) {
		const task = match[1].trim();
		errors.push({
			tool: "lint-staged",
			message: `Task failed: ${task}`,
			raw: match[0],
		});
	}

	return errors;
}

function parseBiomeErrors(output: string): HookError[] {
	const errors: HookError[] = [];
	for (const match of output.matchAll(/^(.+?):(\d+):(\d+)\s+(.+)$/gm)) {
		errors.push({
			tool: "biome",
			message: `${match[1]}:${match[2]}:${match[3]} — ${match[4]}`,
			raw: match[0],
		});
	}

	if (errors.length === 0 && output.includes("biome")) {
		errors.push({
			tool: "biome",
			message: "Biome check failed. See raw output for details.",
			raw: output,
		});
	}

	return errors;
}

function parseTscErrors(output: string): HookError[] {
	const errors: HookError[] = [];
	for (const match of output.matchAll(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm)) {
		errors.push({
			tool: "tsc",
			message: `${match[1]}:${match[2]}:${match[3]} — ${match[4]}: ${match[5]}`,
			raw: match[0],
		});
	}

	return errors;
}

function parseTestErrors(output: string): HookError[] {
	const errors: HookError[] = [];
	const failPattern = /FAIL\s+(.+\.(test|spec)\..+)/;
	const match = failPattern.exec(output);

	if (match) {
		errors.push({
			tool: output.includes("vitest") ? "vitest" : "jest",
			message: `Test file failed: ${match[1]}`,
			raw: output,
		});
	}

	if (errors.length === 0 && (output.includes("vitest") || output.includes("jest"))) {
		errors.push({
			tool: output.includes("vitest") ? "vitest" : "jest",
			message: "Tests failed. See raw output for details.",
			raw: output,
		});
	}

	return errors;
}

function parseEslintErrors(output: string): HookError[] {
	const errors: HookError[] = [];
	for (const match of output.matchAll(/^\s*\d+:(\d+)\s+(error|warning)\s+(.+?)\s+(.+?)$/gm)) {
		errors.push({
			tool: "eslint",
			message: `${match[2]}: ${match[3]} (${match[4]})`,
			raw: match[0],
		});
	}

	return errors;
}

export function formatErrorReport(errors: HookError[]): string {
	if (errors.length === 0) return "";

	const sections = errors.map((e) => `[${e.tool}]\n${e.message}`);
	return sections.join("\n\n");
}

// ── Tool check parsing (success case) ──────────────────────────────

export interface ToolCheck {
	tool: string;
	ok: boolean;
}

/**
 * Parse lint-staged/hook stderr output to discover which tools ran
 * and whether they succeeded. Used for clean post-commit summary.
 */
export function parseToolChecks(stderr: string): ToolCheck[] {
	if (!stderr) return [];

	const checks: ToolCheck[] = [];
	// Match [COMPLETED] and [FAILED] status lines from lint-staged
	for (const match of stderr.matchAll(/\[(COMPLETED|FAILED)\]\s+(.+)/g)) {
		const status = match[1];
		const command = match[2].trim();

		if (isLintStagedMeta(command)) continue;

		const tool = extractToolName(command);
		if (!tool) continue;

		checks.push({ tool, ok: status === "COMPLETED" });
	}

	// Deduplicate by tool name (keep last occurrence — final status)
	const seen = new Map<string, ToolCheck>();
	for (const c of checks) {
		seen.set(c.tool, c);
	}

	return [...seen.values()];
}

/** Heuristic: skip lint-staged internal metadata lines */
function isLintStagedMeta(command: string): boolean {
	// Glob patterns in task labels
	if (/[*{}[\]]/.test(command)) return true;
	// Task count labels: "src/ — 3 files", "src/ — no files"
	// The dash can be em-dash (—), en-dash (–), or plain hyphen (-)
	if (/\s[-–—]\s(\d+\s)?files?$/.test(command)) return true;
	if (/\s[-–—]\sno\s files$/.test(command)) return true;
	// Internal lint-staged lifecycle messages
	if (
		/^(Running tasks|Applying modifications|Cleaning up|Backing up|Backed up|Updating Git)/.test(
			command,
		)
	)
		return true;
	// Ends with ellipsis (e.g. "Backing up original state...")
	if (/\.{3}$/.test(command)) return true;
	return false;
}

/** Extract a display-friendly tool name from a lint-staged command */
function extractToolName(command: string): string | null {
	const tokens = command.split(/\s+/);
	const first = tokens[0];

	// npm/yarn/pnpm run <script>
	if (["npm", "yarn", "pnpm", "bun"].includes(first)) {
		// Skip "run" if present
		const scriptIdx = tokens[1] === "run" ? 2 : 1;
		const script = tokens[scriptIdx];
		if (!script) return null;
		// Map common script names to their underlying tool
		const scriptMap: Record<string, string> = {
			typecheck: "tsc",
			lint: "eslint",
			format: "prettier",
		};
		return scriptMap[script] ?? script;
	}

	// npx <tool>
	if (first === "npx") return tokens[1] ?? null;

	// Direct tool invocation (biome, eslint, tsc, vitest, jest, prettier)
	return first;
}
