import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attemptCommit, attemptCommitNoVerify } from "./git.js";

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
	it("streams hook stderr to process.stderr in real-time", async () => {
		const lintStagedOutput = [
			"✔ Backed up original state in git stash (abc123)",
			"✔ Running tasks for staged files...",
			"✔ Updating Git index again...",
			"✔ Cleaning up temporary files...",
		];

		mockExeca.mockReturnValue(createMockSubprocess({ stderrLines: lintStagedOutput }));

		const result = await attemptCommit("feat: add streaming");

		expect(result.ok).toBe(true);

		// Verify stderr was streamed to process.stderr
		const fullOutput = stderrChunks.join("");
		for (const line of lintStagedOutput) {
			expect(fullOutput).toContain(line);
		}
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
