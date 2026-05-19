import { execa } from "execa";

export async function copyToClipboard(content: string): Promise<boolean> {
	const commands = [
		["wl-copy"],
		["xclip", "-selection", "clipboard"],
		["xsel", "--clipboard", "--input"],
		["pbcopy"],
	];

	for (const [cmd, ...args] of commands) {
		try {
			const { stdout } = await execa("which", [cmd], { reject: false });
			if (!stdout) continue;
			await execa(cmd, args.length > 0 ? args : [], { input: content });
			return true;
		} catch {}
	}
	return false;
}
