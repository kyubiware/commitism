import * as p from "@clack/prompts";
import { bold, cyan, dim, green, red, yellow } from "kolorist";
import { copyToClipboard } from "../services/clipboard.js";
import type { ChangedFile } from "../services/git.js";
import type { HookError } from "../services/hooks.js";
import { debug } from "../utils/debug.js";

export interface StagingChoice {
	files: string[]; // selected file paths to stage
	all: boolean; // whether user chose "Stage all"
}

export async function showStagingMenu(files: ChangedFile[]): Promise<StagingChoice | null> {
	debug("showStagingMenu: %d files", files.length);

	// Build status labels with kolorist colors
	const statusLabel = (status: string): string => {
		switch (status) {
			case "M":
				return yellow("M");
			case "A":
				return green("A");
			case "D":
				return red("D");
			case "?":
				return dim("?");
			default:
				return dim(status);
		}
	};

	const choice = await p.select({
		message: "Stage files for commit:",
		options: [
			{
				label: "Stage all files",
				value: "all",
				hint: `${files.length} file${files.length !== 1 ? "s" : ""}`,
			},
			{ label: "Select files...", value: "select" },
			{ label: "Cancel", value: "cancel" },
		],
	});

	if (p.isCancel(choice) || choice === "cancel") {
		return null;
	}

	if (choice === "all") {
		return { files: files.map((f) => f.path), all: true };
	}

	// Multi-select
	const selected = await p.multiselect({
		message: "Select files to stage:",
		options: files.map((f) => ({
			label: `${statusLabel(f.status)}  ${f.path}`,
			value: f.path,
		})),
		required: true,
	});

	if (p.isCancel(selected)) {
		return null;
	}

	return { files: selected as string[], all: false };
}

export async function showRecoveryMenu(
	errors: HookError[],
	onRetry: () => Promise<boolean>,
	onSkipHooks: (message: string) => Promise<boolean>,
	onRestage: () => Promise<boolean>,
	message: string,
	rawStderr: string,
): Promise<void> {
	debug("showRecoveryMenu: %d errors", errors.length);

	let clipboardCopied = false;
	let showNote = true;

	while (true) {
		if (showNote) {
			p.note(
				errors.map((e) => `  ${red("•")} [${e.tool}] ${e.message}`).join("\n"),
				red(bold("Pre-commit hook failed")),
			);
			showNote = false;
		}

		const choice = await p.select({
			message: "What do you want to do?",
			options: [
				{
					label: clipboardCopied
						? `${green("✓")} Copy error report to clipboard`
						: "Copy error report to clipboard",
					value: "clipboard",
					hint: clipboardCopied ? "Copied!" : "Paste into another terminal for an AI agent",
				},
				{
					label: "Skip hooks and commit (--no-verify)",
					value: "skip",
					hint: "Commit anyway, fix later",
				},
				{
					label: "Re-stage files and retry",
					value: "restage",
					hint: "Pick up fixes from another terminal",
				},
				{
					label: "Edit commit message",
					value: "edit",
					hint: "Modify the message before retrying",
				},
				{ label: "Cancel", value: "cancel" },
			],
		});

		if (p.isCancel(choice)) {
			debug("showRecoveryMenu: user cancelled");
			p.outro(yellow("Cancelled. Message cached for --retry."));
			process.exit(1);
			return;
		}

		debug("showRecoveryMenu: user chose %s", choice);

		switch (choice) {
			case "clipboard": {
				const ok = await copyToClipboard(rawStderr);
				if (ok) {
					clipboardCopied = true;
					p.log.step(green("Copied to clipboard."));
				} else {
					p.log.warn(red("No clipboard tool found. Install xclip, wl-copy, or xsel."));
				}
				continue;
			}
			case "skip": {
				p.log.info(yellow("Committing with --no-verify..."));
				const ok = await onSkipHooks(message);
				if (ok) {
					p.outro(green("Committed (hooks skipped)."));
				} else {
					p.outro(red("Commit failed even with --no-verify."));
				}
				return;
			}
			case "restage": {
				p.log.info(cyan("Re-staging and retrying..."));
				const ok = await onRestage();
				if (ok) {
					p.outro(green("Committed successfully."));
					return;
				}
				// Re-show errors after failed restage for context
				showNote = true;
				continue;
			}
			case "edit": {
				const edited = await p.text({
					message: "Edit commit message:",
					initialValue: message,
					validate: (v) => (v.trim() ? undefined : "Message cannot be empty"),
				});
				if (p.isCancel(edited)) {
					p.outro(yellow("Cancelled. Message cached for --retry."));
					process.exit(1);
					return;
				}
				const ok = await onRetry();
				if (ok) {
					p.outro(green("Committed successfully."));
				} else {
					p.outro(red("Commit failed again."));
				}
				return;
			}
			case "cancel": {
				p.outro(dim("Message cached for --retry."));
				process.exit(1);
				return;
			}
		}
	}
}
