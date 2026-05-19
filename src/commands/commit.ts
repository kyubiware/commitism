import { intro, isCancel, log, outro, spinner } from "@clack/prompts";
import { bold, dim, green, red } from "kolorist";
import { generateCommitMessage } from "../services/ai.js";
import { getApiKey, readConfig, setConfigValue } from "../services/config.js";
import {
	assertGitRepo,
	attemptCommit,
	attemptCommitNoVerify,
	getHead,
	getStagedDiff,
	getStatusShort,
	stageAll,
} from "../services/git.js";
import { parseHookErrors, parseToolChecks } from "../services/hooks.js";
import { showRecoveryMenu } from "../ui/menu.js";
import { loadCachedCommit, saveCachedCommit } from "../utils/cache.js";
import { debug } from "../utils/debug.js";

interface CommitFlags {
	retry: boolean;
	all: boolean;
	message?: string;
	hint?: string;
}

export async function commitCommand(flags: CommitFlags) {
	debug("commitCommand called", { flags });
	await assertGitRepo();

	// ── Retry mode ──────────────────────────────────────────────────
	if (flags.retry) {
		debug("Entering retry mode");
		const { getRepoRoot } = await import("../services/git.js");
		const repoRoot = await getRepoRoot();
		debug("Repo root:", repoRoot);
		const cached = await loadCachedCommit(repoRoot);
		if (!cached) {
			debug("No cached commit found");
			outro(red("No cached commit message found. Run cmint without --retry first."));
			process.exit(1);
		}
		debug("Loaded cached message:", cached.message);
		intro("commit-mint — retry");
		const s = spinner();
		s.start("Retrying commit...");
		const result = await attemptCommit(cached.message);
		s.stop("Attempted commit");
		debug("Retry commit result:", result);
		if (result.ok) {
			// Show clean tool check summary
			const checks = parseToolChecks(result.stderr ?? "");
			if (checks.length > 0) {
				const lines = checks.map((c) => `  ${c.ok ? green("✓") : red("✗")} ${c.tool}`);
				log.info(lines.join("\n"));
			}
			outro(green("Committed successfully."));
		} else {
			const errors = parseHookErrors(result.stderr ?? "");
			debug("Hook errors on retry:", errors.length);
			await showRecoveryMenu(
				errors,
				async () => (await attemptCommit(cached.message)).ok,
				async (msg) => (await attemptCommitNoVerify(msg)).ok,
				async () => {
					await stageAll();
					return (await attemptCommit(cached.message)).ok;
				},
				cached.message,
			);
		}
		return;
	}

	// ── Normal mode ─────────────────────────────────────────────────
	intro("commit-mint");

	const status = await getStatusShort();
	debug("Git status:", status || "(empty)");
	if (!status) {
		outro(dim("Nothing to commit."));
		return;
	}

	// Stage all changes
	const s = spinner();
	s.start("Staging all changes...");
	await stageAll();
	s.stop("Changes staged");

	// Get diff for AI
	const diff = await getStagedDiff();
	if (!diff) {
		debug("No staged changes found after staging");
		outro(red("No staged changes found."));
		process.exit(1);
	}

	debug("Staged files:", diff.files);
	debug("Diff length:", diff.diff.length, "chars");

	log.info(diff.files.map((f) => `     ${f}`).join("\n"));

	// Generate or use provided message
	let message: string;

	if (flags.message) {
		debug("Using provided message:", flags.message);
		message = flags.message;
	} else {
		// Ensure API key is available before generating
		try {
			await getApiKey();
			debug("API key found");
		} catch {
			debug("No API key found, prompting user");
			const { text: promptText } = await import("@clack/prompts");
			const key = await promptText({
				message: "Enter your Groq API key:",
				placeholder: "gsk_...",
				validate: (v: string) => (v.trim() ? undefined : "API key is required"),
			});
			if (isCancel(key)) {
				outro(dim("Cancelled."));
				return;
			}
			await setConfigValue("GROQ_API_KEY", String(key).trim());
			debug("API key saved to config");
		}

		s.start("Generating commit message...");
		try {
			const genStart = Date.now();
			message = await generateMessage(diff.diff, flags.hint);
			debug("generateMessage took %d ms", Date.now() - genStart);
			debug("Generated message:", message);
		} catch (err) {
			s.stop(red("Failed to generate message."));
			debug("Message generation failed:", err instanceof Error ? err.message : String(err));
			outro(red(err instanceof Error ? err.message : String(err)));
			return;
		}
		s.stop("Message generated");
	}

	// Review message
	const { select, text } = await import("@clack/prompts");
	const review = await select({
		message: `Review commit message:\n\n   ${bold(message)}\n`,
		options: [
			{ label: "Use as-is", value: "use" },
			{ label: "Edit", value: "edit" },
			{ label: "Cancel", value: "cancel" },
		],
	});

	if (isCancel(review) || review === "cancel") {
		debug("User cancelled at review step");
		outro(dim("Cancelled."));
		return;
	}

	if (review === "edit") {
		debug("User chose to edit message");
		const edited = await text({
			message: "Edit commit message:",
			initialValue: message,
			validate: (v: string) => (v.trim() ? undefined : "Message cannot be empty"),
		});
		if (isCancel(edited)) {
			outro(dim("Cancelled."));
			return;
		}
		message = String(edited).trim();
		debug("Edited message:", message);
	}

	// Cache message before attempting commit
	const { getRepoRoot } = await import("../services/git.js");
	const repoRoot = await getRepoRoot();
	await saveCachedCommit(repoRoot, message);
	debug("Message cached for repo:", repoRoot);

	// Attempt commit
	s.start("Committing...");
	const headBefore = await getHead();
	debug("HEAD before commit:", headBefore);
	const result = await attemptCommit(message);
	const headAfter = await getHead();
	debug("HEAD after commit:", headAfter);
	debug("Commit result:", result);

	if (result.ok || headBefore !== headAfter) {
		s.stop("Committed successfully.");

		// Show clean tool check summary
		const checks = parseToolChecks(result.stderr ?? "");
		if (checks.length > 0) {
			const lines = checks.map((c) => `  ${c.ok ? green("✓") : red("✗")} ${c.tool}`);
			log.info(lines.join("\n"));
		}

		outro(green("Done."));
		return;
	}

	s.stop("Commit failed.");
	debug("Commit failed, showing recovery menu");

	// Hook failure — show recovery menu
	const errors = parseHookErrors(result.stderr ?? "");
	debug("Parsed hook errors:", errors.length, "errors");
	await showRecoveryMenu(
		errors,
		async () => {
			const r = await attemptCommit(message);
			return r.ok;
		},
		async (msg) => {
			const r = await attemptCommitNoVerify(msg);
			return r.ok;
		},
		async () => {
			await stageAll();
			const r = await attemptCommit(message);
			return r.ok;
		},
		message,
	);
}

async function generateMessage(diff: string, hint?: string): Promise<string> {
	const config = await readConfig();
	const apiKey = await getApiKey();
	debug(
		"Generating message with model:",
		config.model,
		"max-length:",
		config["max-length"],
		"type:",
		config.type,
	);

	return generateCommitMessage(diff, {
		apiKey,
		model: config.model,
		maxLength: config["max-length"] ? parseInt(config["max-length"], 10) : undefined,
		type: config.type,
		timeout: config.timeout ? parseInt(config.timeout, 10) : undefined,
		hint,
	});
}
