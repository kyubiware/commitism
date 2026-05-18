#!/usr/bin/env node
import { cli, command } from "cleye";
import pkg from "../package.json" with { type: "json" };
const { version } = pkg;
import { commitCommand } from "./commands/commit.js";
import { configCommand } from "./commands/config.js";

cli(
	{
		name: "commitism",
		version,
		description: "A commit tool that actually handles hook failures",
		flags: {
			retry: {
				type: Boolean,
				description: "Retry the last failed commit",
				alias: "r",
				default: false,
			},
			all: {
				type: Boolean,
				description: "Auto-stage all tracked files",
				alias: "a",
				default: false,
			},
			message: {
				type: String,
				description: "Provide a commit message directly (skip AI generation)",
				alias: "m",
			},
			hint: {
				type: String,
				description: "Add context hint for AI commit message generation",
				alias: "H",
			},
		},
		commands: [configCommand],
	},
	(argv) => {
		commitCommand(argv.flags);
	},
);
