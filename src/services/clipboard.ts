import { spawn } from "node:child_process";

export async function copyToClipboard(content: string): Promise<boolean> {
	const commands: [string, string[]][] = [
		["wl-copy", []],
		["xclip", ["-selection", "clipboard"]],
		["xsel", ["--clipboard", "--input"]],
		["pbcopy", []],
	];

	for (const [cmd, args] of commands) {
		try {
			const success = await new Promise<boolean>((resolve) => {
				const child = spawn(cmd, args, {
					stdio: ["pipe", "ignore", "ignore"],
				});

				let settled = false;
				const done = (result: boolean) => {
					if (settled) return;
					settled = true;
					resolve(result);
				};

				// Command not found (ENOENT)
				child.on("error", () => done(false));
				// Tool failed immediately (e.g. wl-copy on non-Wayland)
				child.on("exit", (code) => {
					if (code !== 0) done(false);
				});

				child.stdin.write(content, (err) => {
					if (err) {
						done(false);
						return;
					}
					child.stdin.end(() => {
						// Content sent to tool — don't wait for exit since
						// clipboard tools (xclip, wl-copy) hold selection open
						child.unref();
						done(true);
					});
				});
			});

			if (success) return true;
		} catch {}
	}
	return false;
}
