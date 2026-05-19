import type { ExecaError } from "execa";
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
	const lines = stderr.split("\n");

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
	const taskPattern = /\[FAILED\]\s+(.+?)\s+\[FAILED\]/g;
	let match: RegExpExecArray | null;

	while ((match = taskPattern.exec(output)) !== null) {
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
	const biomePattern = /^(.+?):(\d+):(\d+)\s+(.+)$/gm;
	let match: RegExpExecArray | null;

	while ((match = biomePattern.exec(output)) !== null) {
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
	const tscPattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
	let match: RegExpExecArray | null;

	while ((match = tscPattern.exec(output)) !== null) {
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
	const eslintPattern = /^\s*\d+:(\d+)\s+(error|warning)\s+(.+?)\s+(.+?)$/gm;
	let match: RegExpExecArray | null;

	while ((match = eslintPattern.exec(output)) !== null) {
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
