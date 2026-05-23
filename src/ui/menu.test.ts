import { beforeEach, describe, expect, it, vi } from "vitest";
import { showRecoveryMenu } from "./menu.js";

// Mock all external dependencies
vi.mock("@clack/prompts", () => ({
	note: vi.fn(),
	select: vi.fn(),
	outro: vi.fn(),
	log: { info: vi.fn(), step: vi.fn(), warn: vi.fn() },
	isCancel: vi.fn(() => false),
	text: vi.fn(),
}));

vi.mock("../services/clipboard.js", () => ({
	copyToClipboard: vi.fn(),
}));

vi.mock("../services/hooks.js", () => ({}));

vi.mock("../utils/debug.js", () => ({
	debug: vi.fn(),
}));

import { log, select } from "@clack/prompts";
import { copyToClipboard } from "../services/clipboard.js";

const mockErrors = [
	{
		tool: "biome",
		message: "src/foo.ts:1:1 — unused variable",
		raw: "src/foo.ts:1:1 — unused variable",
	},
];

const mockRawStderr = "raw stderr output from hooks";

describe("showRecoveryMenu", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should NOT call process.exit after clipboard copy — should return to menu", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		vi.mocked(copyToClipboard).mockResolvedValue(true);

		// User picks "clipboard" first, then "cancel"
		vi.mocked(select).mockResolvedValueOnce("clipboard").mockResolvedValueOnce("cancel");

		await showRecoveryMenu(
			mockErrors,
			async () => false,
			async () => false,
			async () => false,
			"test message",
			mockRawStderr,
		);

		// Should show the menu at least twice (clipboard + cancel)
		expect(select).toHaveBeenCalledTimes(2);

		// Should have called copyToClipboard with raw stderr
		expect(copyToClipboard).toHaveBeenCalledWith(mockRawStderr);

		// process.exit should only be called once (from the "cancel" case), NOT from clipboard
		expect(exitSpy).toHaveBeenCalledTimes(1);
		expect(exitSpy).toHaveBeenCalledWith(1); // cancel exits with 1

		exitSpy.mockRestore();
	});

	it("should show success message after clipboard copy succeeds", async () => {
		vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		vi.mocked(copyToClipboard).mockResolvedValue(true);
		vi.mocked(select).mockResolvedValueOnce("clipboard").mockResolvedValueOnce("cancel");

		await showRecoveryMenu(
			mockErrors,
			async () => false,
			async () => false,
			async () => false,
			"test message",
			mockRawStderr,
		);

		// log.step should be called with a success message for clipboard
		expect(log.step).toHaveBeenCalledWith(expect.stringContaining("Copied"));
	});

	it("should show error message when clipboard is unavailable", async () => {
		vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		vi.mocked(copyToClipboard).mockResolvedValue(false);
		vi.mocked(select).mockResolvedValueOnce("clipboard").mockResolvedValueOnce("cancel");

		await showRecoveryMenu(
			mockErrors,
			async () => false,
			async () => false,
			async () => false,
			"test message",
			mockRawStderr,
		);

		// Should show error about missing clipboard tool
		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("clipboard tool"));
	});

	it("should allow user to take another action after copying to clipboard", async () => {
		vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		vi.mocked(copyToClipboard).mockResolvedValue(true);

		const onSkipHooks = vi.fn().mockResolvedValue(true);

		// User picks clipboard, then skip hooks
		vi.mocked(select).mockResolvedValueOnce("clipboard").mockResolvedValueOnce("skip");

		await showRecoveryMenu(
			mockErrors,
			async () => false,
			onSkipHooks,
			async () => false,
			"test message",
			mockRawStderr,
		);

		// Should have called both clipboard and skip hooks
		expect(copyToClipboard).toHaveBeenCalled();
		expect(onSkipHooks).toHaveBeenCalledWith("test message");
	});
});
