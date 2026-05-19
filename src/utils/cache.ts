import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

const CACHE_DIR = join(os.homedir(), ".cache", "commit-mint");

function repoHash(repoPath: string): string {
	return createHash("sha256").update(repoPath).digest("hex").slice(0, 12);
}

function cachePath(repoPath: string): string {
	return join(CACHE_DIR, `${repoHash(repoPath)}.json`);
}

export interface CachedCommit {
	message: string;
	timestamp: number;
	repoPath: string;
}

export async function saveCachedCommit(repoPath: string, message: string) {
	await mkdir(CACHE_DIR, { recursive: true });
	const data: CachedCommit = {
		message,
		timestamp: Date.now(),
		repoPath,
	};
	await writeFile(cachePath(repoPath), JSON.stringify(data, null, 2), "utf8");
}

export async function loadCachedCommit(repoPath: string): Promise<CachedCommit | null> {
	try {
		const raw = await readFile(cachePath(repoPath), "utf8");
		return JSON.parse(raw) as CachedCommit;
	} catch {
		return null;
	}
}
