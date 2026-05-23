import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard.js";

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

import { spawn } from "node:child_process";

function mockSuccessfulChild() {
	return {
		on: vi.fn(),
		stdin: {
			write: vi.fn((_content: string, cb: (err?: null) => void) => cb(null)),
			end: vi.fn((cb: () => void) => cb()),
		},
		unref: vi.fn(),
	};
}

function mockFailedChild() {
	return {
		on: vi.fn(),
		stdin: {
			write: vi.fn((_content: string, cb: (err: Error) => void) => cb(new Error("not found"))),
			end: vi.fn(),
		},
		unref: vi.fn(),
	};
}

describe("copyToClipboard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should copy content using wl-copy when available", async () => {
		vi.mocked(spawn).mockReturnValue(mockSuccessfulChild() as never);

		const result = await copyToClipboard("test content");

		expect(result).toBe(true);
		expect(spawn).toHaveBeenCalledWith("wl-copy", [], {
			stdio: ["pipe", "ignore", "ignore"],
		});
	});

	it("should fallback to xclip when wl-copy is not available", async () => {
		vi.mocked(spawn)
			.mockReturnValueOnce(mockFailedChild() as never) // wl-copy fails
			.mockReturnValueOnce(mockSuccessfulChild() as never); // xclip succeeds

		const result = await copyToClipboard("test content");

		expect(result).toBe(true);
		expect(spawn).toHaveBeenCalledWith("xclip", ["-selection", "clipboard"], {
			stdio: ["pipe", "ignore", "ignore"],
		});
	});

	it("should try all tools and return false when none are available", async () => {
		vi.mocked(spawn).mockReturnValue(mockFailedChild() as never);

		const result = await copyToClipboard("test content");

		expect(result).toBe(false);
		expect(spawn).toHaveBeenCalledTimes(4); // all 4 tools tried
	});
});
