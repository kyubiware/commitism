import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("groq-sdk", () => {
	class MockAPIError extends Error {
		constructor(
			public status?: number,
			public error?: unknown,
			message?: string,
			public headers?: unknown,
		) {
			super(message);
		}
	}

	class MockAuthenticationError extends MockAPIError {
		constructor(status?: number, error?: unknown, message?: string, headers?: unknown) {
			super(status ?? 401, error ?? {}, message ?? "Unauthorized", headers ?? {});
		}
	}

	class MockRateLimitError extends MockAPIError {
		constructor(status?: number, error?: unknown, message?: string, headers?: unknown) {
			super(status ?? 429, error ?? {}, message ?? "Rate limited", headers ?? {});
		}
	}

	class MockAPIConnectionTimeoutError extends MockAPIError {
		constructor(status?: number, error?: unknown, message?: string, headers?: unknown) {
			super(status ?? 0, error ?? {}, message ?? "Connection timeout", headers ?? {});
		}
	}

	class MockGroq {
		chat = {
			completions: {
				create: mockCreate,
			},
		};

		static AuthenticationError = MockAuthenticationError;
		static RateLimitError = MockRateLimitError;
		static APIConnectionTimeoutError = MockAPIConnectionTimeoutError;
		static APIError = MockAPIError;
	}

	return {
		default: MockGroq,
	};
});

import { generateCommitMessage } from "./ai.js";

describe("generateCommitMessage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns valid conventional commit on happy path", async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: "feat(cli): add hint flag" } }],
		});

		const result = await generateCommitMessage("some diff", { apiKey: "test_key" });

		expect(result).toBe("feat(cli): add hint flag");
		expect(mockCreate).toHaveBeenCalledTimes(1);
	});

	it("injects hint into user prompt content", async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: "feat: test" } }],
		});

		await generateCommitMessage("some diff", { apiKey: "test_key", hint: "refactor auth" });

		const userPrompt = mockCreate.mock.calls[0][0].messages[1].content;
		expect(userPrompt).toContain("Context: refactor auth");
	});

	it("adds type constraint to system prompt when type is provided", async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: "feat: test" } }],
		});

		await generateCommitMessage("some diff", { apiKey: "test_key", type: "feat" });

		const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content;
		expect(systemPrompt).toContain("MUST use type: feat");
	});

	it("does not force a type when type is undefined", async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: "feat: test" } }],
		});

		await generateCommitMessage("some diff", { apiKey: "test_key" });

		const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content;
		expect(systemPrompt).not.toContain("MUST use type:");
	});

	it("does not force a type when type is empty string", async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: "feat: test" } }],
		});

		await generateCommitMessage("some diff", { apiKey: "test_key", type: "" });

		const systemPrompt = mockCreate.mock.calls[0][0].messages[0].content;
		expect(systemPrompt).not.toContain("MUST use type:");
	});

	it("passes full diff under 40K chars without truncation", async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: "feat: test" } }],
		});

		const diff = "a".repeat(1000);
		await generateCommitMessage(diff, { apiKey: "test_key" });

		const userPrompt = mockCreate.mock.calls[0][0].messages[1].content;
		expect(userPrompt).toContain(diff);
	});

	it("truncates lines over 256 chars when diff exceeds 40K", async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: "feat: test" } }],
		});

		const longLine = "a".repeat(300);
		const diff = `diff --git a/file b/file\n${longLine}\n${"b".repeat(40000)}`;
		await generateCommitMessage(diff, { apiKey: "test_key" });

		const userPrompt = mockCreate.mock.calls[0][0].messages[1].content;
		expect(userPrompt).toContain(`${"a".repeat(256)}...`);
		expect(userPrompt).not.toContain(longLine);
	});

	it("truncates hunks when diff still exceeds 40K after line truncation", async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: "feat: test" } }],
		});

		// Create a diff >40K with lines under 256 chars
		const lines = Array.from({ length: 250 }, (_, i) => `+line ${i} ${"x".repeat(180)}`);
		const diff = `diff --git a/file1 b/file1\n${lines.join("\n")}\ndiff --git a/file2 b/file2\n${lines.join("\n")}`;
		await generateCommitMessage(diff, { apiKey: "test_key" });

		const userPrompt = mockCreate.mock.calls[0][0].messages[1].content;
		// After truncation, should be <= 40K + prefix
		expect(userPrompt.length).toBeLessThanOrEqual(41000);
	});

	it("returns empty string when API response content is empty", async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: "" } }],
		});

		const result = await generateCommitMessage("some diff", { apiKey: "test_key" });

		expect(result).toBe("");
	});

	it("returns empty string when API response content is null", async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: null } }],
		});

		const result = await generateCommitMessage("some diff", { apiKey: "test_key" });

		expect(result).toBe("");
	});

	it("auto-retries once when AI returns non-conventional format and second call succeeds", async () => {
		mockCreate
			.mockResolvedValueOnce({
				choices: [{ message: { content: "not a conventional commit" } }],
			})
			.mockResolvedValueOnce({
				choices: [{ message: { content: "feat: valid commit" } }],
			});

		const result = await generateCommitMessage("some diff", { apiKey: "test_key" });

		expect(result).toBe("feat: valid commit");
		expect(mockCreate).toHaveBeenCalledTimes(2);
	});

	it("returns original message when auto-retry also fails", async () => {
		mockCreate
			.mockResolvedValueOnce({
				choices: [{ message: { content: "not valid" } }],
			})
			.mockResolvedValueOnce({
				choices: [{ message: { content: "still not valid" } }],
			});

		const result = await generateCommitMessage("some diff", { apiKey: "test_key" });

		expect(result).toBe("not valid");
		expect(mockCreate).toHaveBeenCalledTimes(2);
	});

	it("does not retry when AI returns correctly formatted conventional commit", async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: "feat: valid commit" } }],
		});

		const result = await generateCommitMessage("some diff", { apiKey: "test_key" });

		expect(result).toBe("feat: valid commit");
		expect(mockCreate).toHaveBeenCalledTimes(1);
	});

	it("enforces maxLength by truncating long messages", async () => {
		mockCreate.mockResolvedValue({
			choices: [{ message: { content: "a".repeat(150) } }],
		});

		const result = await generateCommitMessage("some diff", {
			apiKey: "test_key",
			maxLength: 50,
		});

		expect(result).toBe(`${"a".repeat(47)}...`);
	});

	it("throws clear API key message on AuthenticationError", async () => {
		const { default: Groq } = await import("groq-sdk");
		mockCreate.mockRejectedValue(new Groq.AuthenticationError(401, {}, "Unauthorized", {}));

		await expect(generateCommitMessage("some diff", { apiKey: "test_key" })).rejects.toThrow(
			"Invalid GROQ_API_KEY",
		);
	});

	it("throws rate limit message on RateLimitError", async () => {
		const { default: Groq } = await import("groq-sdk");
		mockCreate.mockRejectedValue(new Groq.RateLimitError(429, {}, "Rate limited", {}));

		await expect(generateCommitMessage("some diff", { apiKey: "test_key" })).rejects.toThrow(
			"Rate limited by Groq",
		);
	});

	it("throws timeout message on APIConnectionTimeoutError", async () => {
		const { default: Groq } = await import("groq-sdk");
		mockCreate.mockRejectedValue(new Groq.APIConnectionTimeoutError({ message: "Timeout" }));

		await expect(generateCommitMessage("some diff", { apiKey: "test_key" })).rejects.toThrow(
			"Request timed out",
		);
	});

	it("throws API error message on generic APIError", async () => {
		const { default: Groq } = await import("groq-sdk");
		mockCreate.mockRejectedValue(new Groq.APIError(500, {}, "Server Error", {}));

		await expect(generateCommitMessage("some diff", { apiKey: "test_key" })).rejects.toThrow(
			"Groq API error: Server Error",
		);
	});

	it("throws unexpected error message on non-Groq error", async () => {
		mockCreate.mockRejectedValue(new Error("Something went wrong"));

		await expect(generateCommitMessage("some diff", { apiKey: "test_key" })).rejects.toThrow(
			"Unexpected error: Something went wrong",
		);
	});
});
