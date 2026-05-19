import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import ini from "ini";
import { debug } from "../utils/debug.js";

const CONFIG_PATH = join(os.homedir(), ".commit-mint");

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
	debug("readConfig: loading from %s", CONFIG_PATH);
	try {
		const raw = await readFile(CONFIG_PATH, "utf8");
		const parsed = ini.parse(raw);
		const merged = { ...defaults, ...parsed };
		debug("readConfig: loaded keys: %s", Object.keys(merged).join(", "));
		return merged;
	} catch {
		debug("readConfig: no config file, using defaults");
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
	if (envKey) {
		debug("getApiKey: found in env");
		return envKey;
	}

	const config = await readConfig();
	if (config.GROQ_API_KEY) {
		debug("getApiKey: found in config");
		return config.GROQ_API_KEY;
	}

	debug("getApiKey: not found");
	throw new Error("Please set your Groq API key via `cmint config set GROQ_API_KEY=<your token>`");
}
