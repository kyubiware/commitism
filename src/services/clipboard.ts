import { execa } from "execa";

export async function copyToClipboard(content: string): Promise<boolean> {
	const commands: [string, string[]][] = [
		["wl-copy", []],
		["xclip", ["-selection", "clipboard"]],
		["xsel", ["--clipboard", "--input"]],
		["pbcopy", []],
	];

	for (const [cmd, args] of commands) {
		try {
			await execa(cmd, args, { input: content });
			return true;
		} catch {}
	}
	return false;
}
