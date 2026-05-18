import * as p from "@clack/prompts";
import { red, green, yellow, dim, bold, cyan } from "kolorist";
import type { HookError } from "../services/hooks.js";
import { formatErrorReport } from "../services/hooks.js";
import { copyToClipboard } from "../services/clipboard.js";

export async function showRecoveryMenu(
	errors: HookError[],
	onRetry: () => Promise<boolean>,
	onSkipHooks: (message: string) => Promise<boolean>,
	onRestage: () => Promise<boolean>,
	message: string,
): Promise<void> {
	p.note(
		errors.map((e) => `  ${red("•")} [${e.tool}] ${e.message}`).join("\n"),
		red(bold("Pre-commit hook failed")),
	);

	const choice = await p.select({
		message: "What do you want to do?",
		options: [
			{ label: "Copy error report to clipboard", value: "clipboard", hint: "Paste into another terminal for an AI agent" },
			{ label: "Skip hooks and commit (--no-verify)", value: "skip", hint: "Commit anyway, fix later" },
			{ label: "Re-stage files and retry", value: "restage", hint: "Pick up fixes from another terminal" },
			{ label: "Edit commit message", value: "edit", hint: "Modify the message before retrying" },
			{ label: "Cancel", value: "cancel" },
		],
	});

	if (p.isCancel(choice)) {
		p.outro(yellow("Cancelled. Message cached for --retry."));
		process.exit(1);
	}

	switch (choice) {
		case "clipboard": {
			const report = formatErrorReport(errors);
			const ok = await copyToClipboard(report);
			if (ok) {
				p.outro(green("Error report copied to clipboard."));
			} else {
				p.outro(red("No clipboard tool found. Install xclip, wl-copy, or xsel."));
			}
			p.log.info(dim("Fix the errors, then run: commitism --retry"));
			process.exit(0);
			break;
		}
		case "skip": {
			p.log.info(yellow("Committing with --no-verify..."));
			const ok = await onSkipHooks(message);
			if (ok) {
				p.outro(green("Committed (hooks skipped)."));
			} else {
				p.outro(red("Commit failed even with --no-verify."));
			}
			break;
		}
		case "restage": {
			p.log.info(cyan("Re-staging and retrying..."));
			const ok = await onRestage();
			if (ok) {
				p.outro(green("Committed successfully."));
			} else {
				// Recursive — show menu again
				await showRecoveryMenu(errors, onRetry, onSkipHooks, onRestage, message);
			}
			break;
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
			}
			const ok = await onRetry();
			if (ok) {
				p.outro(green("Committed successfully."));
			} else {
				p.outro(red("Commit failed again."));
			}
			break;
		}
		case "cancel": {
			p.outro(dim("Message cached for --retry."));
			process.exit(1);
		}
	}
}
