/**
 * Implementations of `tellme daemon start | stop | status`.
 */

import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PROTOCOL_VERSION } from "../core/daemon-protocol.js";
import { ensureDaemonDir, getLogPath, getPidPath, getSocketPath } from "../core/daemon-paths.js";
import { connectAndSend } from "../core/daemon-client.js";
import { isCompiledBinary } from "../core/runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findBinPath(): string {
	// src/cli/daemon-cmd.ts → ../../bin/tellme.js
	return join(__dirname, "..", "..", "bin", "tellme.js");
}

async function statusPing(): Promise<{ running: boolean; socketPath?: string; queueDepth?: number }> {
	const { messages, ok } = await connectAndSend({ kind: "status", version: PROTOCOL_VERSION });
	if (!ok || messages.length === 0) return { running: false };
	const reply = messages.find((m) => m.kind === "status");
	if (reply) {
		return { running: true, socketPath: reply.socketPath, queueDepth: reply.queueDepth };
	}
	return { running: false };
}

export interface EnsureDaemonOptions {
	/** Override the spawn step (used by tests). Default: detached spawn of the bin entrypoint. */
	spawner?: () => void;
	/** Maximum time to wait for the daemon to become reachable. Default: 5000ms. */
	waitMs?: number;
}

/**
 * Ensure a daemon is reachable. If one already answers `status`, return true
 * immediately. Otherwise spawn a fresh daemon (via `opts.spawner` or the
 * default detached-process pattern) and poll for readiness. Returns `false`
 * on timeout or — in the default-spawner path — early exit. This helper is
 * silent: logging is the caller's responsibility.
 */
export async function ensureDaemonRunning(opts: EnsureDaemonOptions = {}): Promise<boolean> {
	const probe = await statusPing();
	if (probe.running) return true;

	const waitMs = opts.waitMs ?? 5000;

	let earlyExit = false;
	if (opts.spawner) {
		opts.spawner();
	} else {
		const args = isCompiledBinary()
			? ["__daemon-main__"]
			: [findBinPath(), "__daemon-main__"];

		// Capture daemon stdout/stderr to a log file. Without this we lose
		// every backend init message, sherpa-ffi dlopen path, and any crash
		// trace from the detached process.
		ensureDaemonDir();
		const logFd = openSync(getLogPath(), "a");
		const proc = spawn(process.execPath, args, {
			detached: true,
			stdio: ["ignore", logFd, logFd],
		});
		proc.unref();
		proc.once("exit", () => { earlyExit = true; });
	}

	const deadline = Date.now() + waitMs;
	while (Date.now() < deadline) {
		if (earlyExit) return false;
		await new Promise((r) => setTimeout(r, 100));
		const s = await statusPing();
		if (s.running) return true;
	}
	return false;
}

export async function daemonStart(): Promise<number> {
	const probe = await statusPing();
	if (probe.running) {
		console.log("daemon already running");
		console.log(`  socket: ${probe.socketPath}`);
		return 0;
	}
	const ok = await ensureDaemonRunning();
	if (ok) {
		const s = await statusPing();
		console.log(`daemon started (socket: ${s.socketPath})`);
		return 0;
	}
	console.error("Error: daemon did not start within 5s");
	return 1;
}

function isAlive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (e: any) {
		if (e?.code === "ESRCH") return false;
		return true; // EPERM etc — process exists
	}
}

export async function daemonStop(): Promise<number> {
	const pidPath = getPidPath();
	const socketPath = getSocketPath();

	if (!existsSync(pidPath) && !existsSync(socketPath)) {
		console.log("daemon not running");
		return 0;
	}

	let pid: number | null = null;
	try {
		const raw = readFileSync(pidPath, "utf-8").trim();
		const n = parseInt(raw, 10);
		if (!isNaN(n)) pid = n;
	} catch { /* ignore */ }

	if (pid !== null) {
		try { process.kill(pid, "SIGTERM"); }
		catch { /* already dead */ }
	}

	if (pid !== null) {
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline && isAlive(pid)) {
			await new Promise((r) => setTimeout(r, 100));
		}
		if (isAlive(pid)) {
			try { process.kill(pid, "SIGKILL"); }
			catch { /* ignore */ }
			const killDeadline = Date.now() + 2000;
			while (Date.now() < killDeadline && isAlive(pid)) {
				await new Promise((r) => setTimeout(r, 100));
			}
			if (isAlive(pid)) {
				process.stderr.write(`Error: daemon process ${pid} did not exit after SIGKILL\n`);
				return 1;
			}
		}
	} else {
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline && existsSync(socketPath)) {
			await new Promise((r) => setTimeout(r, 100));
		}
	}

	if (existsSync(socketPath)) {
		try { unlinkSync(socketPath); } catch { /* ignore */ }
	}
	if (existsSync(pidPath)) {
		try { unlinkSync(pidPath); } catch { /* ignore */ }
	}

	console.log("daemon stopped");
	return 0;
}

export async function daemonStatus(): Promise<number> {
	const s = await statusPing();
	if (!s.running) {
		console.log("running: false");
		return 0;
	}
	console.log("running: true");
	console.log(`socket: ${s.socketPath}`);
	console.log(`queue: ${s.queueDepth}`);
	return 0;
}
