import type { ExecaError } from "execa";
import { execa } from "execa";

export class KnownError extends Error {}

export async function assertGitRepo() {
	const { failed } = await execa("git", ["rev-parse", "--show-toplevel"], {
		reject: false,
	});
	if (failed) {
		throw new KnownError("The current directory must be a Git repository!");
	}
}

export async function getRepoRoot() {
	const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"]);
	return stdout.trim();
}

export async function getStagedDiff(exclude?: string[]) {
	const excludeArgs = (exclude ?? []).map((e) => `:(exclude)${e}`);
	const defaultExcludes = [
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
	].map((e) => `:(exclude)${e}`);

	const { stdout: files } = await execa("git", [
		"diff",
		"--cached",
		"--name-only",
		...defaultExcludes,
		...excludeArgs,
	]);
	if (!files) return null;

	const { stdout: diff } = await execa("git", [
		"diff",
		"--cached",
		"--diff-algorithm=minimal",
		...defaultExcludes,
		...excludeArgs,
	]);

	return { files: files.split("\n").filter(Boolean), diff };
}

export async function stageAll() {
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
	stderr?: string;
}

export async function attemptCommit(message: string, extraArgs: string[] = []): Promise<CommitResult> {
	try {
		await execa("git", ["commit", "-m", message, ...extraArgs]);
		return { ok: true };
	} catch (error) {
		const e = error as ExecaError;
		return {
			ok: false,
			error: e.message,
			stderr: e.stderr ?? "",
		};
	}
}

export async function attemptCommitNoVerify(message: string): Promise<CommitResult> {
	return attemptCommit(message, ["--no-verify"]);
}
