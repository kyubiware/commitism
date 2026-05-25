import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewCommand } from "./review.js";

// Mock all external dependencies
vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	log: { info: vi.fn(), message: vi.fn(), step: vi.fn(), warn: vi.fn() },
	note: vi.fn(),
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
	})),
	isCancel: vi.fn(() => false),
	select: vi.fn(),
	multiselect: vi.fn(),
	text: vi.fn(),
}));

vi.mock("../services/git.js", () => ({
	assertGitRepo: vi.fn(),
	getStagedDiff: vi.fn(),
	getRepoRoot: vi.fn(),
	stageAll: vi.fn(),
}));

vi.mock("../services/config.js", () => ({
	getApiKey: vi.fn(),
	readConfig: vi.fn(),
}));

vi.mock("../services/review-ai.js", () => ({
	generateCodeReview: vi.fn(),
}));

vi.mock("../services/clipboard.js", () => ({
	copyToClipboard: vi.fn(),
}));

vi.mock("../utils/debug.js", () => ({
	debug: vi.fn(),
}));

// Mock execa globally so dynamic imports in review.ts get the mock
const mockExeca = vi.fn();
vi.mock("execa", () => ({
	execa: mockExeca,
}));

import { note, outro, select } from "@clack/prompts";
import { copyToClipboard } from "../services/clipboard.js";
import { getApiKey, readConfig } from "../services/config.js";
import { assertGitRepo, getRepoRoot, getStagedDiff, stageAll } from "../services/git.js";
import { generateCodeReview } from "../services/review-ai.js";

const mockedAssertGitRepo = vi.mocked(assertGitRepo);
const mockedGetStagedDiff = vi.mocked(getStagedDiff);
const mockedGetRepoRoot = vi.mocked(getRepoRoot);
const mockedStageAll = vi.mocked(stageAll);
const mockedReadConfig = vi.mocked(readConfig);
const mockedGetApiKey = vi.mocked(getApiKey);
const mockedGenerateCodeReview = vi.mocked(generateCodeReview);
const mockedCopyToClipboard = vi.mocked(copyToClipboard);
const mockedSelect = vi.mocked(select);
const mockedOutro = vi.mocked(outro);
const mockedNote = vi.mocked(note);

function makeDiffResult(
	files = ["src/test.ts"],
	diff = "diff --git a/src/test.ts b/src/test.ts\n+console.log('hello')",
) {
	return { files, diff };
}

describe("reviewCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedAssertGitRepo.mockResolvedValue(undefined);
		mockedStageAll.mockResolvedValue(undefined);
		mockedGetStagedDiff.mockResolvedValue(makeDiffResult());
		mockedGetRepoRoot.mockResolvedValue("/fake/repo");
		mockedReadConfig.mockResolvedValue({
			model: "openai/gpt-oss-20b",
			timeout: "30000",
		});
		mockedGetApiKey.mockResolvedValue("gsk_test-key");
		mockedGenerateCodeReview.mockResolvedValue("All good!");

		// Default: opencode not available
		mockExeca.mockResolvedValue({ exitCode: 1, stdout: "" });
	});

	it("stages all files before reviewing", async () => {
		await reviewCommand();

		expect(mockedStageAll).toHaveBeenCalledTimes(1);
	});

	it("exits early when no staged changes after staging", async () => {
		mockedGetStagedDiff.mockResolvedValue(null);

		await reviewCommand();

		expect(mockedOutro).toHaveBeenCalledWith(expect.stringContaining("No changes to review"));
		expect(mockedGenerateCodeReview).not.toHaveBeenCalled();
	});

	it("exits early when all files are excluded", async () => {
		mockedGetStagedDiff.mockResolvedValue({
			excludedFiles: ["package-lock.json"],
		} as never);

		await reviewCommand();

		expect(mockedOutro).toHaveBeenCalledWith(expect.stringContaining("excluded from review"));
		expect(mockedGenerateCodeReview).not.toHaveBeenCalled();
	});

	it("uses opencode when CLI is available", async () => {
		mockExeca.mockResolvedValue({ exitCode: 0, stdout: "No issues found." });

		await reviewCommand();

		expect(mockedGenerateCodeReview).not.toHaveBeenCalled();
	});

	it("falls back to Groq when opencode is not available", async () => {
		// Default mock: opencode not available
		mockedGenerateCodeReview.mockResolvedValue("Looks good!");

		await reviewCommand();

		expect(mockedGenerateCodeReview).toHaveBeenCalled();
	});

	it("shows review findings and copies to clipboard", async () => {
		const report = "- SEVERITY: major\n- LOCATION: src/test.ts:5\n- ISSUE: Missing error handling";
		mockedGenerateCodeReview.mockResolvedValue(report);
		mockedSelect.mockResolvedValue("yes");
		mockedCopyToClipboard.mockResolvedValue(true);

		await reviewCommand();

		expect(mockedNote).toHaveBeenCalledWith(expect.stringContaining(report), expect.any(String));
		expect(mockedCopyToClipboard).toHaveBeenCalledWith(report);
		expect(mockedOutro).toHaveBeenCalledWith(expect.stringContaining("copied to clipboard"));
	});

	it("does not copy to clipboard when user declines", async () => {
		mockedGenerateCodeReview.mockResolvedValue("- SEVERITY: minor\n- ISSUE: Nit");
		mockedSelect.mockResolvedValue("no");

		await reviewCommand();

		expect(mockedNote).toHaveBeenCalled();
		expect(mockedCopyToClipboard).not.toHaveBeenCalled();
		expect(mockedOutro).toHaveBeenCalledWith(expect.stringContaining("Done."));
	});

	it("shows success message when no issues found", async () => {
		mockedGenerateCodeReview.mockResolvedValue("NO_ISSUES_FOUND");

		await reviewCommand();

		expect(mockedOutro).toHaveBeenCalledWith(expect.stringContaining("No issues found"));
		expect(mockedNote).not.toHaveBeenCalled();
	});

	it("handles review generation errors gracefully", async () => {
		mockedGenerateCodeReview.mockRejectedValue(new Error("API error"));

		await expect(reviewCommand()).rejects.toThrow("API error");
	});

	it("handles clipboard copy failure", async () => {
		mockedGenerateCodeReview.mockResolvedValue("Some issues found");
		mockedSelect.mockResolvedValue("yes");
		mockedCopyToClipboard.mockResolvedValue(false);

		await reviewCommand();

		expect(mockedOutro).toHaveBeenCalledWith(expect.stringContaining("Failed to copy"));
	});
});
