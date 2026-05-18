import { command } from "cleye";
import { getConfigValue, setConfigValue } from "../services/config.js";

export const configCommand = command(
	{
		name: "config",
		parameters: ["<mode>", "<key=value...>"],
	},
	async (argv) => {
		const { mode, keyValue } = argv._;

		if (mode === "get") {
			for (const kv of keyValue) {
				const key = kv.split("=")[0];
				const value = await getConfigValue(key);
				console.log(`${key}=${value ?? ""}`);
			}
			return;
		}

		if (mode === "set") {
			for (const kv of keyValue) {
				const [key, ...rest] = kv.split("=");
				const value = rest.join("=");
				await setConfigValue(key, value);
			}
			console.log("Config updated.");
			return;
		}

		console.error(`Unknown config mode: ${mode}. Use "get" or "set".`);
		process.exit(1);
	},
);
