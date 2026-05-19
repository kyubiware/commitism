import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard.js";

vi.mock("execa", () => ({
	execa: vi.fn(),
}));

import { execa } from "execa";

describe("copyToClipboard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should copy content using wl-copy when available", async () => {
		// wl-copy found via direct execution (no separate which check)
		vi.mocked(execa)
			.mockResolvedValueOnce({ stdout: "" } as never) // wl-copy succeeds
			.mockRejectedValueOnce(new Error("not found")) // xclip fails
			.mockRejectedValueOnce(new Error("not found")) // xsel fails
			.mockRejectedValueOnce(new Error("not found")); // pbcopy fails

		// We need wl-copy to succeed, so first call is wl-copy with input
		vi.mocked(execa).mockReset();
		vi.mocked(execa).mockResolvedValueOnce({ stdout: "" } as never); // wl-copy succeeds with input

		const result = await copyToClipboard("test content");

		expect(result).toBe(true);
		expect(execa).toHaveBeenCalledWith("wl-copy", [], {
			input: "test content",
		});
	});

	it("should fallback to xclip when wl-copy is not available", async () => {
		vi.mocked(execa)
			.mockRejectedValueOnce(new Error("wl-copy not found")) // wl-copy fails
			.mockResolvedValueOnce({ stdout: "" } as never); // xclip succeeds

		const result = await copyToClipboard("test content");

		expect(result).toBe(true);
		expect(execa).toHaveBeenCalledWith("xclip", ["-selection", "clipboard"], {
			input: "test content",
		});
	});

	it("should try all tools and return false when none are available", async () => {
		vi.mocked(execa).mockRejectedValue(new Error("not found"));

		const result = await copyToClipboard("test content");

		expect(result).toBe(false);
	});
});
