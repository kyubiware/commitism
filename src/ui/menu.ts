import * as p from "@clack/prompts";
import { bold, cyan, dim, green, red, yellow } from "kolorist";
import { copyToClipboard } from "../services/clipboard.js";
import type { HookError } from "../services/hooks.js";
import { debug } from "../utils/debug.js";

export async function showRecoveryMenu(
	errors: HookError[],
	onRetry: () => Promise<boolean>,
	onSkipHooks: (message: string) => Promise<boolean>,
	onRestage: () => Promise<boolean>,
	message: string,
	rawStderr: string,
): Promise<void> {
	debug("showRecoveryMenu: %d errors", errors.length);

	while (true) {
		p.note(
			errors.map((e) => `  ${red("•")} [${e.tool}] ${e.message}`).join("\n"),
			red(bold("Pre-commit hook failed")),
		);

		const choice = await p.select({
			message: "What do you want to do?",
			options: [
				{
					label: "Copy error report to clipboard",
					value: "clipboard",
					hint: "Paste into another terminal for an AI agent",
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
					p.log.step(green("Errors copied"));
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
				// Loop back to menu on failure
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
