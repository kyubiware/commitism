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
import { parseHookErrors } from "../services/hooks.js";
import { showRecoveryMenu } from "../ui/menu.js";
import { loadCachedCommit, saveCachedCommit } from "../utils/cache.js";

interface CommitFlags {
	retry: boolean;
	all: boolean;
	message?: string;
	hint?: string;
}

export async function commitCommand(flags: CommitFlags) {
	await assertGitRepo();

	// ── Retry mode ──────────────────────────────────────────────────
	if (flags.retry) {
		const { getRepoRoot } = await import("../services/git.js");
		const repoRoot = await getRepoRoot();
		const cached = await loadCachedCommit(repoRoot);
		if (!cached) {
			outro(red("No cached commit message found. Run cmint without --retry first."));
			process.exit(1);
		}
		intro("commit-mint — retry");
		const s = spinner();
		s.start("Retrying commit...");
		const result = await attemptCommit(cached.message);
		s.stop("Attempted commit");
		if (result.ok) {
			outro(green("Committed successfully."));
		} else {
			const errors = parseHookErrors(result.stderr ?? "");
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
		outro(red("No staged changes found."));
		process.exit(1);
	}

	log.info(diff.files.map((f) => `     ${f}`).join("\n"));

	// Generate or use provided message
	let message: string;

	if (flags.message) {
		message = flags.message;
	} else {
		// Ensure API key is available before generating
		try {
			await getApiKey();
		} catch {
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
		}

		s.start("Generating commit message...");
		try {
			message = await generateMessage(diff.diff, flags.hint);
		} catch (err) {
			s.stop(red("Failed to generate message."));
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
		outro(dim("Cancelled."));
		return;
	}

	if (review === "edit") {
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
	}

	// Cache message before attempting commit
	const { getRepoRoot } = await import("../services/git.js");
	const repoRoot = await getRepoRoot();
	await saveCachedCommit(repoRoot, message);

	// Attempt commit
	s.start("Committing...");
	const headBefore = await getHead();
	const result = await attemptCommit(message);
	const headAfter = await getHead();

	if (result.ok || headBefore !== headAfter) {
		s.stop("Committed successfully.");
		outro(green("Done."));
		return;
	}

	s.stop("Commit failed.");

	// Hook failure — show recovery menu
	const errors = parseHookErrors(result.stderr ?? "");
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

	return generateCommitMessage(diff, {
		apiKey,
		model: config.model,
		maxLength: config["max-length"] ? parseInt(config["max-length"], 10) : undefined,
		type: config.type,
		timeout: config.timeout ? parseInt(config.timeout, 10) : undefined,
		hint,
	});
}
