import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	attemptCommit,
	attemptCommitNoVerify,
	getChangedFiles,
	getStagedDiff,
	stageFiles,
} from "./git.js";

// Mock execa
const mockExeca = vi.fn();
vi.mock("execa", () => ({
	execa: (...args: unknown[]) => mockExeca(...args),
}));

// Mock debug
vi.mock("../utils/debug.js", () => ({
	debug: vi.fn(),
}));

// Capture stderr output
const stderrChunks: string[] = [];
const originalStderrWrite = process.stderr.write.bind(process.stderr);

beforeEach(() => {
	vi.clearAllMocks();
	stderrChunks.length = 0;
	process.stderr.write = vi.fn((chunk: string | Buffer) => {
		stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
		return true;
	}) as never;
});

afterEach(() => {
	process.stderr.write = originalStderrWrite;
});

/**
 * Creates a mock execa subprocess that:
 * - Has a .stderr Readable stream that emits given lines
 * - Is thenable (await resolves with { stdout, stderr })
 *
 * biome-ignore: the .then/.catch/.finally properties are required
 * to simulate execa's thenable subprocess return type.
 */
function createMockSubprocess(options?: { stderrLines?: string[] }) {
	const stderrStream = new Readable({ read() {} });

	const resultPromise = new Promise<{ stdout: string; stderr: string }>((resolve) => {
		setImmediate(() => {
			if (options?.stderrLines) {
				for (const line of options.stderrLines) {
					stderrStream.push(Buffer.from(`${line}\n`));
				}
			}
			stderrStream.push(null);
			resolve({
				stdout: "",
				stderr: options?.stderrLines?.join("\n") ?? "",
			});
		});
	});

	// execa returns a thenable subprocess with .stderr
	return Object.assign(resultPromise, {
		stderr: stderrStream,
		// biome-ignore lint/suspicious/noThenProperty: mock needs to be a thenable to simulate execa's subprocess
		then: resultPromise.then.bind(resultPromise),
		catch: resultPromise.catch.bind(resultPromise),
		finally: resultPromise.finally.bind(resultPromise),
	});
}

describe("attemptCommit", () => {
	it("collects hook stderr in CommitResult on success", async () => {
		const lintStagedOutput = [
			"[STARTED] biome check --write",
			"[COMPLETED] biome check --write",
			"[STARTED] npm run typecheck",
			"[COMPLETED] npm run typecheck",
		];

		mockExeca.mockReturnValue(createMockSubprocess({ stderrLines: lintStagedOutput }));

		const result = await attemptCommit("feat: add checks");

		expect(result.ok).toBe(true);
		expect(result.stderr).toContain("biome check --write");
		expect(result.stderr).toContain("npm run typecheck");
	});

	it("captures stderr in result on failure", async () => {
		const error = Object.assign(new Error("Command failed: git commit"), {
			stderr: "✖ Running tasks for staged files...\n✖ biome check --apply failed without output",
		});

		mockExeca.mockImplementation(() => {
			throw error;
		});

		const result = await attemptCommit("feat: broken");

		expect(result.ok).toBe(false);
		expect(result.stderr).toContain("biome check --apply failed");
	});

	it("returns ok:true when commit succeeds with no hook output", async () => {
		mockExeca.mockReturnValue(createMockSubprocess({ stderrLines: [] }));

		const result = await attemptCommit("chore: cleanup");

		expect(result.ok).toBe(true);
	});

	it("passes correct args to execa", async () => {
		mockExeca.mockReturnValue(createMockSubprocess({ stderrLines: [] }));

		await attemptCommit("feat: test");

		expect(mockExeca).toHaveBeenCalledWith("git", ["commit", "-m", "feat: test"]);
	});

	it("passes extra args to git commit", async () => {
		mockExeca.mockReturnValue(createMockSubprocess({ stderrLines: [] }));

		await attemptCommit("feat: test", ["--no-verify"]);

		expect(mockExeca).toHaveBeenCalledWith("git", ["commit", "-m", "feat: test", "--no-verify"]);
	});
});

describe("attemptCommitNoVerify", () => {
	it("calls attemptCommit with --no-verify flag", async () => {
		mockExeca.mockReturnValue(createMockSubprocess({ stderrLines: [] }));

		const result = await attemptCommitNoVerify("feat: bypass hooks");

		expect(result.ok).toBe(true);
		expect(mockExeca).toHaveBeenCalledWith("git", [
			"commit",
			"-m",
			"feat: bypass hooks",
			"--no-verify",
		]);
	});
});

describe("getStagedDiff", () => {
	it("returns null when nothing is staged", async () => {
		// First call: git diff --cached --name-only (no excludes) → empty
		mockExeca.mockResolvedValue({ stdout: "" });

		const result = await getStagedDiff();

		expect(result).toBeNull();
	});

	it("returns files and diff when non-excluded files are staged", async () => {
		mockExeca
			// First call: git diff --cached --name-only (no excludes) → finds staged files
			.mockResolvedValueOnce({ stdout: "src/foo.ts\nsrc/bar.ts" })
			// Second call: git diff --cached --name-only (with excludes) → same files
			.mockResolvedValueOnce({ stdout: "src/foo.ts\nsrc/bar.ts" })
			// Third call: git diff --cached --diff-algorithm=minimal (with excludes)
			.mockResolvedValueOnce({ stdout: "diff content here" });

		const result = await getStagedDiff();

		expect(result).toEqual({
			files: ["src/foo.ts", "src/bar.ts"],
			diff: "diff content here",
		});
	});

	it("returns excludedFiles when all staged files are excluded", async () => {
		mockExeca
			// First call: git diff --cached --name-only WITHOUT excludes → finds staged files
			.mockResolvedValueOnce({ stdout: "package-lock.json" })
			// Second call: git diff --cached --name-only WITH excludes → empty
			.mockResolvedValueOnce({ stdout: "" });

		const result = await getStagedDiff();

		expect(result).toEqual({ excludedFiles: ["package-lock.json"] });
	});

	it("returns excludedFiles with multiple lockfiles", async () => {
		mockExeca
			.mockResolvedValueOnce({ stdout: "package-lock.json\npnpm-lock.yaml" })
			.mockResolvedValueOnce({ stdout: "" });

		const result = await getStagedDiff();

		expect(result).toEqual({ excludedFiles: ["package-lock.json", "pnpm-lock.yaml"] });
	});
});

describe("getChangedFiles", () => {
	it("returns empty array when no changes", async () => {
		mockExeca.mockResolvedValue({ stdout: "" });
		const result = await getChangedFiles();
		expect(result).toEqual([]);
	});

	it("parses status short output into ChangedFile array", async () => {
		mockExeca.mockResolvedValue({ stdout: "M  src/foo.ts\n?? src/new.ts\n D src/old.ts" });
		const result = await getChangedFiles();
		expect(result).toEqual([
			{ status: "M", path: "src/foo.ts", staged: true },
			{ status: "??", path: "src/new.ts", staged: false },
			{ status: "D", path: "src/old.ts", staged: false },
		]);
	});

	it("parses worktree-modified files with leading space in status", async () => {
		mockExeca.mockResolvedValue({ stdout: " M src/commands/commit.ts" });
		const result = await getChangedFiles();
		expect(result).toEqual([{ status: "M", path: "src/commands/commit.ts", staged: false }]);
	});

	it("calls git status --short", async () => {
		mockExeca.mockResolvedValue({ stdout: "" });
		await getChangedFiles();
		expect(mockExeca).toHaveBeenCalledWith("git", ["status", "--short"]);
	});
});

describe("stageFiles", () => {
	it("stages specific files", async () => {
		mockExeca.mockResolvedValue({ stdout: "" });
		await stageFiles(["src/foo.ts", "src/bar.ts"]);
		expect(mockExeca).toHaveBeenCalledWith("git", ["add", "src/foo.ts", "src/bar.ts"]);
	});

	it("stages a single file", async () => {
		mockExeca.mockResolvedValue({ stdout: "" });
		await stageFiles(["src/foo.ts"]);
		expect(mockExeca).toHaveBeenCalledWith("git", ["add", "src/foo.ts"]);
	});
});
