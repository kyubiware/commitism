import { describe, it, expect, vi, beforeEach } from "vitest";
import { commitCommand } from "./commit.js";

// Mock all external dependencies
vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
	})),
	isCancel: vi.fn(() => false),
	select: vi.fn(),
	text: vi.fn(),
}));

vi.mock("../services/git.js", () => ({
	assertGitRepo: vi.fn(),
	getStagedDiff: vi.fn(),
	stageAll: vi.fn(),
	getHead: vi.fn(),
	attemptCommit: vi.fn(),
	attemptCommitNoVerify: vi.fn(),
	getStatusShort: vi.fn(),
	getRepoRoot: vi.fn(),
}));

vi.mock("../services/hooks.js", () => ({
	parseHookErrors: vi.fn(() => []),
}));

vi.mock("../ui/menu.js", () => ({
	showRecoveryMenu: vi.fn(),
}));

vi.mock("../utils/cache.js", () => ({
	saveCachedCommit: vi.fn(),
	loadCachedCommit: vi.fn(),
}));

vi.mock("../services/config.js", () => ({
	getApiKey: vi.fn(),
	readConfig: vi.fn(),
	setConfigValue: vi.fn(),
}));

import { getStagedDiff, stageAll, getStatusShort, attemptCommit, getHead } from "../services/git.js";
import { getApiKey, setConfigValue } from "../services/config.js";
import { text } from "@clack/prompts";

describe("commitCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("handles errors from generateMessage without unhandled rejection", async () => {
		vi.mocked(getStatusShort).mockResolvedValue("M  src/foo.ts");
		vi.mocked(stageAll).mockResolvedValue(undefined);
		vi.mocked(getStagedDiff).mockResolvedValue({
			files: ["src/foo.ts"],
			diff: "some diff",
		});
		vi.mocked(getApiKey).mockRejectedValue(
			new Error("Please set your Groq API key via `commitism config set GROQ_API_KEY=<your token>`"),
		);

		// Should NOT throw — errors should be caught and handled gracefully
		await expect(commitCommand({ retry: false, all: false })).resolves.not.toThrow();
	});

	it("prompts for API key when missing, saves it, then continues", async () => {
		vi.mocked(getStatusShort).mockResolvedValue("M  src/foo.ts");
		vi.mocked(stageAll).mockResolvedValue(undefined);
		vi.mocked(getStagedDiff).mockResolvedValue({
			files: ["src/foo.ts"],
			diff: "some diff",
		});

		// First call throws (no key), second call succeeds (after prompt+save)
		vi.mocked(getApiKey)
			.mockRejectedValueOnce(new Error("No API key"))
			.mockResolvedValueOnce("gsk_test_key_123");

		// User enters key in prompt
		vi.mocked(text).mockResolvedValue("gsk_test_key_123");
		vi.mocked(attemptCommit).mockResolvedValue({ ok: true });
		vi.mocked(getHead).mockResolvedValueOnce("abc123").mockResolvedValueOnce("abc123");

		await commitCommand({ retry: false, all: false });

		// Should have prompted for the key
		expect(text).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("API key") }),
		);

		// Should have saved the key to config
		expect(setConfigValue).toHaveBeenCalledWith("GROQ_API_KEY", "gsk_test_key_123");
	});
});
