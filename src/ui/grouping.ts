import * as p from "@clack/prompts";
import { bold, cyan, dim, green } from "kolorist";
import type { CommitGroup } from "../services/grouping.js";
import { debug } from "../utils/debug.js";

export async function showGroupingConfirmation(
	groups: CommitGroup[],
	excluded: string[],
): Promise<boolean> {
	debug("showGroupingConfirmation: %d groups, %d excluded", groups.length, excluded.length);

	const lines: string[] = [];

	for (const group of groups) {
		lines.push(bold(group.name));
		lines.push(`  ${dim(group.description)}`);
		lines.push(`  ${green(String(group.files.length))} file${group.files.length !== 1 ? "s" : ""}`);
		for (const file of group.files) {
			lines.push(`    ${dim("•")} ${file}`);
		}
		lines.push("");
	}

	if (excluded.length > 0) {
		lines.push(dim(`Excluded: ${excluded.length} file${excluded.length !== 1 ? "s" : ""}`));
		for (const file of excluded) {
			lines.push(`  ${dim("•")} ${dim(file)}`);
		}
	}

	p.note(lines.join("\n"), "Proposed commit groups");

	const choice = await p.select({
		message: "Proceed with these groupings?",
		options: [
			{ label: "Yes, commit all groups", value: "yes" },
			{ label: "No, cancel", value: "no" },
		],
	});

	if (p.isCancel(choice) || choice === "no") {
		debug("showGroupingConfirmation: user cancelled");
		return false;
	}

	debug("showGroupingConfirmation: user confirmed");
	return true;
}

export function showGroupProgress(current: number, total: number, groupName: string): void {
	p.log.info(`Commit group ${current} of ${total}: ${cyan(`"${groupName}"`)}`);
}
