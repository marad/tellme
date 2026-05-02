/**
 * Daemon client — connects to the daemon socket and drives one request.
 *
 * `tryDaemonRoute` is the entry point used by the CLI: it returns null
 * when the daemon is not reachable so the CLI can fall through to the
 * in-process path. Otherwise it sends a speak request and returns the
 * appropriate exit code once the daemon signals completion.
 */

import { createConnection, type Socket } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { PROTOCOL_VERSION, readMessages, writeMessage, type ClientMessage, type ServerMessage } from "./daemon-protocol.js";
import { getSocketPath } from "./daemon-paths.js";
import type { TellMeConfig } from "./config.js";

export interface CliArgs {
	text: string | null;
	language: TellMeConfig["language"];
	voice: string;
	speed: number;
	raw: boolean;
}

/**
 * Try to route a speak request through the daemon.
 *
 * Returns:
 *   - `null` when the daemon socket is missing or refuses connections
 *     (caller falls back to in-process synthesis).
 *   - exit code (0 for done, 1 for error/version-mismatch, 130 for stopped).
 */
export async function tryDaemonRoute(args: CliArgs): Promise<number | null> {
	const path = getSocketPath();
	if (!existsSync(path)) return null;

	let socket: Socket;
	try {
		socket = await connect(path);
	} catch (err: any) {
		if (err?.code === "ECONNREFUSED") {
			try { unlinkSync(path); } catch { /* ignore */ }
			return null;
		}
		if (err?.code === "ENOENT") return null;
		// Other connect error — fall back to in-process.
		return null;
	}

	const req = {
		kind: "speak" as const,
		version: PROTOCOL_VERSION,
		text: args.text ?? "",
		lang: args.language,
		voice: args.voice,
		speed: args.speed,
		raw: args.raw,
	};

	try {
		await writeMessage(socket, req);
	} catch (err) {
		console.error("Error: failed to send to daemon:", (err as Error).message);
		try { socket.destroy(); } catch { /* ignore */ }
		return 1;
	}

	let resolved: number | null = null;
	try {
		for await (const msg of readMessages(socket)) {
			if (msg.kind === "version-mismatch") {
				console.error(
					`Error: tellme daemon protocol mismatch (CLI v${msg.expected}, daemon v${msg.got}). ` +
					`Restart the daemon: tellme daemon stop && tellme daemon start.`,
				);
				resolved = 1;
				break;
			}
			else if (msg.kind === "ack") continue;
			else if (msg.kind === "done") { resolved = 0; break; }
			else if (msg.kind === "error") {
				console.error("Error:", msg.message);
				resolved = 1;
				break;
			}
			else if (msg.kind === "stopped") { resolved = 130; break; }
			else {
				console.error(`Warning: unknown daemon message kind: ${(msg as any).kind}`);
			}
		}
	} catch (err) {
		console.error("Error: daemon connection failed:", (err as Error).message);
		return 1;
	}

	if (resolved === null) {
		console.error("Error: daemon closed connection without completing the request.");
		return 1;
	}
	return resolved;
}

/**
 * Connect, send one message, collect every reply until EOF, and return them.
 * Used by the `daemon` subcommands (status / stop probes).
 */
export async function connectAndSend(req: ClientMessage): Promise<{ messages: ServerMessage[]; ok: boolean }> {
	const path = getSocketPath();
	if (!existsSync(path)) return { messages: [], ok: false };

	let socket: Socket;
	try {
		socket = await connect(path);
	} catch {
		return { messages: [], ok: false };
	}

	try {
		await writeMessage(socket, req);
	} catch {
		try { socket.destroy(); } catch { /* ignore */ }
		return { messages: [], ok: false };
	}

	const messages: ServerMessage[] = [];
	try {
		for await (const msg of readMessages(socket)) {
			messages.push(msg);
		}
	} catch {
		// fall through with what we have
	}
	return { messages, ok: true };
}

function connect(path: string): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(path);
		socket.once("connect", () => {
			socket.off("error", reject);
			resolve(socket);
		});
		socket.once("error", reject);
	});
}
