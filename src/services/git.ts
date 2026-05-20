import type { ExecaError } from "execa";
import { execa } from "execa";
import { debug } from "../utils/debug.js";

export class KnownError extends Error {}

export async function assertGitRepo() {
	debug("assertGitRepo");
	const { failed } = await execa("git", ["rev-parse", "--show-toplevel"], {
		reject: false,
	});
	if (failed) {
		throw new KnownError("The current directory must be a Git repository!");
	}
}

export async function getRepoRoot() {
	const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"]);
	debug("getRepoRoot:", stdout.trim());
	return stdout.trim();
}

export interface StagedDiffResult {
	files: string[];
	diff: string;
}

export interface ExcludedFilesResult {
	excludedFiles: string[];
}

export type DiffResult = StagedDiffResult | ExcludedFilesResult | null;

const DEFAULT_EXCLUDES = [
	"package-lock.json",
	"node_modules/**",
	"dist/**",
	"build/**",
	".next/**",
	"coverage/**",
	"*.log",
	"*.min.js",
	"*.min.css",
	"*.lock",
	".DS_Store",
];

export function getDefaultExcludes(): string[] {
	return [...DEFAULT_EXCLUDES];
}

export async function getStagedDiff(exclude?: string[]): Promise<DiffResult> {
	const excludeArgs = (exclude ?? []).map((e) => `:(exclude)${e}`);
	const defaultExcludeArgs = DEFAULT_EXCLUDES.map((e) => `:(exclude)${e}`);

	// Check all staged files without excludes to detect "all excluded" case
	const { stdout: allFiles } = await execa("git", ["diff", "--cached", "--name-only"]);
	if (!allFiles) {
		debug("getStagedDiff: no staged files");
		return null;
	}

	// Check staged files with excludes applied
	const { stdout: files } = await execa("git", [
		"diff",
		"--cached",
		"--name-only",
		...defaultExcludeArgs,
		...excludeArgs,
	]);

	if (!files) {
		// All staged files were excluded
		const excludedFiles = allFiles.split("\n").filter(Boolean);
		debug("getStagedDiff: all files excluded:", excludedFiles);
		return { excludedFiles };
	}

	const { stdout: diff } = await execa("git", [
		"diff",
		"--cached",
		"--diff-algorithm=minimal",
		...defaultExcludeArgs,
		...excludeArgs,
	]);

	debug("getStagedDiff:", files.split("\n").filter(Boolean).length, "files,", diff.length, "chars");
	return { files: files.split("\n").filter(Boolean), diff };
}

export async function stageAll() {
	debug("stageAll: git add -A");
	await execa("git", ["add", "-A"]);
}

export async function getHead() {
	const { stdout } = await execa("git", ["rev-parse", "HEAD"]);
	return stdout.trim();
}

export async function getStatusShort() {
	const { stdout } = await execa("git", ["status", "--short"]);
	return stdout.trim();
}

export interface CommitResult {
	ok: boolean;
	error?: string;
	/** Collected stderr from hooks/lint-staged — set on both success and failure */
	stderr?: string;
}

export async function attemptCommit(
	message: string,
	extraArgs: string[] = [],
): Promise<CommitResult> {
	debug("attemptCommit:", message, extraArgs.length ? extraArgs : "(no extra args)");
	try {
		const subprocess = execa("git", ["commit", "-m", message, ...extraArgs]);

		// Collect hook output (lint-staged, biome, etc.) for post-commit display
		// We don't stream to the terminal — the success/failure result is enough
		const stderrChunks: string[] = [];
		subprocess.stderr?.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk.toString());
		});

		await subprocess;
		debug("attemptCommit: success");
		return { ok: true, stderr: stderrChunks.join("") };
	} catch (error) {
		const e = error as ExecaError;
		debug("attemptCommit: failed —", e.message?.slice(0, 200));
		return {
			ok: false,
			error: e.message,
			stderr: typeof e.stderr === "string" ? e.stderr : "",
		};
	}
}

export async function attemptCommitNoVerify(message: string): Promise<CommitResult> {
	debug("attemptCommitNoVerify:", message);
	return attemptCommit(message, ["--no-verify"]);
}
