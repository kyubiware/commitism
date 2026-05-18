import { execa } from "execa";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import ini from "ini";

const CONFIG_PATH = join(os.homedir(), ".commitism");

interface Config {
	GROQ_API_KEY?: string;
	model?: string;
	locale?: string;
	"max-length"?: string;
	type?: string;
	proxy?: string;
	timeout?: string;
}

const defaults: Config = {
	model: "openai/gpt-oss-20b",
	locale: "en",
	"max-length": "100",
	type: "",
	timeout: "10000",
};

export async function readConfig(): Promise<Config> {
	try {
		const raw = await readFile(CONFIG_PATH, "utf8");
		const parsed = ini.parse(raw);
		return { ...defaults, ...parsed };
	} catch {
		return { ...defaults };
	}
}

export async function writeConfig(updates: Record<string, string>) {
	const existing = await readConfig();
	Object.assign(existing, updates);
	await writeFile(CONFIG_PATH, ini.stringify(existing), "utf8");
}

export async function getConfigValue(key: string): Promise<string | undefined> {
	const config = await readConfig();
	return config[key as keyof Config];
}

export async function setConfigValue(key: string, value: string) {
	await writeConfig({ [key]: value });
}

export async function getApiKey(): Promise<string> {
	const envKey = process.env.GROQ_API_KEY;
	if (envKey) return envKey;

	const config = await readConfig();
	if (config.GROQ_API_KEY) return config.GROQ_API_KEY;

	throw new Error(
		"Please set your Groq API key via `commitism config set GROQ_API_KEY=<your token>`",
	);
}
