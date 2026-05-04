/**
 * Filesystem paths for the tellme daemon.
 *
 * Default location is `~/.tellme/`. Tests may override via the
 * `TELLME_DAEMON_DIR` env var so they can use a temp dir.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function getDaemonDir(): string {
	const override = process.env.TELLME_DAEMON_DIR;
	if (override && override.length > 0) return override;
	return join(homedir(), ".tellme");
}

export function getSocketPath(): string {
	return join(getDaemonDir(), "daemon.sock");
}

export function getPidPath(): string {
	return join(getDaemonDir(), "daemon.pid");
}

export function getLogPath(): string {
	return join(getDaemonDir(), "daemon.log");
}

export function ensureDaemonDir(): void {
	const dir = getDaemonDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}
