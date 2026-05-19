import { dim } from "kolorist";

let enabled = false;

export function setDebug(value: boolean): void {
	enabled = value;
}

export function isDebug(): boolean {
	return enabled;
}

export function debug(...args: unknown[]): void {
	if (!enabled) return;
	const timestamp = new Date().toISOString().slice(11, 23);
	console.error(dim(`[debug ${timestamp}]`), ...args);
}
