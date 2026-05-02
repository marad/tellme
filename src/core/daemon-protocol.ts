/**
 * Wire protocol for the tellme background daemon.
 *
 * Length-prefixed JSON framing: 4-byte big-endian length + UTF-8 JSON.
 * The protocol is intentionally minimal — only what FEAT-0001 needs.
 */

import type { Readable, Writable } from "node:stream";

export const PROTOCOL_VERSION = 1;

// ── Client → server ──

export interface SpeakRequest {
	kind: "speak";
	version: number;
	text: string;
	lang?: "auto" | "en" | "pl";
	voice?: string;
	speed?: number;
	raw?: boolean;
}

export interface StopRequest {
	kind: "stop";
	version: number;
}

export interface StatusRequest {
	kind: "status";
	version: number;
}

export type ClientMessage = SpeakRequest | StopRequest | StatusRequest;

// ── Server → client ──

export interface AckMessage {
	kind: "ack";
}

export interface DoneMessage {
	kind: "done";
	ok: true;
}

export interface ErrorMessage {
	kind: "error";
	message: string;
}

export interface StoppedMessage {
	kind: "stopped";
}

export interface StatusReply {
	kind: "status";
	running: true;
	socketPath: string;
	queueDepth: number;
	version: number;
}

export interface VersionMismatchMessage {
	kind: "version-mismatch";
	expected: number;
	got: number;
}

export type ServerMessage =
	| AckMessage
	| DoneMessage
	| ErrorMessage
	| StoppedMessage
	| StatusReply
	| VersionMismatchMessage;

// ── Framing ──

/**
 * Write one JSON message to the stream framed with a 4-byte big-endian length.
 * Resolves once the data has been flushed to the underlying socket.
 */
export function writeMessage(stream: Writable, msg: object): Promise<void> {
	return new Promise((resolve, reject) => {
		const json = Buffer.from(JSON.stringify(msg), "utf-8");
		const header = Buffer.alloc(4);
		header.writeUInt32BE(json.length, 0);
		const ok = stream.write(Buffer.concat([header, json]), (err) => {
			if (err) reject(err);
			else resolve();
		});
		if (!ok) {
			// Backpressure — wait for drain. The callback above still fires.
		}
	});
}

/**
 * Async iterable that yields parsed JSON messages from a stream.
 * Buffers partial frames across `data` events. Stops on `end`.
 */
export async function* readMessages(stream: Readable): AsyncGenerator<any, void, void> {
	let buf = Buffer.alloc(0);
	const queue: any[] = [];
	let resolveNext: (() => void) | null = null;
	let ended = false;
	let error: Error | null = null;

	const onData = (chunk: Buffer) => {
		buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
		while (buf.length >= 4) {
			const len = buf.readUInt32BE(0);
			if (buf.length < 4 + len) break;
			const json = buf.subarray(4, 4 + len).toString("utf-8");
			buf = buf.subarray(4 + len);
			try {
				queue.push(JSON.parse(json));
			} catch (e) {
				error = e as Error;
				ended = true;
				break;
			}
		}
		if (resolveNext) {
			const r = resolveNext;
			resolveNext = null;
			r();
		}
	};

	const onEnd = () => {
		ended = true;
		if (resolveNext) {
			const r = resolveNext;
			resolveNext = null;
			r();
		}
	};

	const onError = (err: Error) => {
		error = err;
		ended = true;
		if (resolveNext) {
			const r = resolveNext;
			resolveNext = null;
			r();
		}
	};

	stream.on("data", onData);
	stream.on("end", onEnd);
	stream.on("close", onEnd);
	stream.on("error", onError);

	try {
		while (true) {
			if (queue.length > 0) {
				yield queue.shift();
				continue;
			}
			if (ended) {
				if (error) throw error;
				return;
			}
			await new Promise<void>((resolve) => { resolveNext = resolve; });
		}
	} finally {
		stream.off("data", onData);
		stream.off("end", onEnd);
		stream.off("close", onEnd);
		stream.off("error", onError);
	}
}
