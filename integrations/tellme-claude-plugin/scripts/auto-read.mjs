#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { readState } from "./state.mjs";
import { speakOneShot } from "./socket.mjs";

const DEBUG = process.env.TELLME_PLUGIN_DEBUG === "1";
const DEBUG_LOG = "/tmp/tellme-plugin.log";

function debug(...args) {
	if (!DEBUG) return;
	const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
	try { appendFileSync(DEBUG_LOG, line); } catch {}
}

async function readStdin() {
	return new Promise((resolve) => {
		let data = "";
		if (process.stdin.isTTY) return resolve("");
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => { data += chunk; });
		process.stdin.on("end", () => resolve(data));
		process.stdin.on("error", () => resolve(data));
	});
}

function shellOutToCli(text) {
	return new Promise((resolve) => {
		try {
			const child = spawn("tellme", [], {
				stdio: ["pipe", "ignore", "ignore"],
				detached: true,
			});
			child.on("error", () => resolve());
			child.stdin.end(text, "utf8");
			child.unref();
		} catch {}
		resolve();
	});
}

async function main() {
	const stdin = await readStdin();
	if (!stdin) process.exit(0);

	let input;
	try {
		input = JSON.parse(stdin);
	} catch {
		process.exit(0);
	}

	const projectDir = input.cwd || process.env.CLAUDE_PROJECT_DIR;
	if (!projectDir) process.exit(0);

	const state = readState(projectDir);
	if (!state.autoRead) {
		debug("auto-read off, no-op", { event: input.hook_event_name });
		process.exit(0);
	}

	const text = typeof input.last_assistant_message === "string" ? input.last_assistant_message.trim() : "";
	debug("hook fire", { event: input.hook_event_name, hasMessage: !!text, len: text.length, preview: text.slice(0, 80) });

	if (!text) process.exit(0);

	try {
		await speakOneShot(text);
		debug("spoke via socket");
	} catch (err) {
		debug("socket failed, falling back to CLI", err && err.message);
		await shellOutToCli(text);
	}
	process.exit(0);
}

main().catch((err) => {
	debug("uncaught", err && err.message);
	process.exit(0);
});
