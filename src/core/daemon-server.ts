/**
 * Background TTS daemon — keeps models warm and serializes playback.
 *
 * Listens on a per-user Unix domain socket. Each connection is one request.
 * Speak requests are queued FIFO and processed by a single worker so audio
 * never overlaps. Stop clears the queue and aborts the active utterance.
 */

import { createServer, createConnection, type Server, type Socket } from "node:net";
import { chmodSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { loadConfig, type TellMeConfig } from "./config.js";
import { TellMeTts } from "./tts-engine.js";
import { detectLanguage } from "./language-detect.js";
import { prepareForSpeech, splitIntoChunks } from "./text-prep.js";
import { createStreamingPlayer, playAudio, type StreamingPlayer } from "./audio-player.js";
import {
	PROTOCOL_VERSION,
	readMessages,
	writeMessage,
	type SpeakRequest,
} from "./daemon-protocol.js";
import {
	ensureDaemonDir,
	getPidPath,
	getSocketPath,
} from "./daemon-paths.js";

// ── Engine seam (so tests can substitute a fake) ──

export interface DaemonTtsEngine {
	init(): Promise<void>;
	getSampleRate(language: "en" | "pl"): number;
	/**
	 * Synthesize audio for `text` honoring per-call overrides. The engine is
	 * responsible for restoring its own state when the call finishes so
	 * subsequent calls see daemon defaults again (AC-7).
	 */
	speak(args: {
		text: string;
		language: "en" | "pl";
		overrides: { voice?: string; speed?: number };
		onChunk: (samples: Float32Array) => void;
		shouldStop: () => boolean;
	}): Promise<{ sampleRate: number }>;
	free(): void;
}

export type TtsFactory = (config: TellMeConfig) => DaemonTtsEngine;

/**
 * Default factory — wraps the real TellMeTts. For each speak call it
 * temporarily mutates the engine config to apply per-request overrides
 * and restores the originals in finally so overrides never leak.
 */
const defaultTtsFactory: TtsFactory = (config) => {
	const tts = new TellMeTts(config);
	return {
		async init() { await tts.init(); },
		getSampleRate(language) { return tts.getSampleRate(language); },
		async speak({ text, language, overrides, onChunk, shouldStop }) {
			const cfg = (tts as any).config as TellMeConfig;
			const origVoice = cfg.enVoice;
			const origSpeed = cfg.speed;
			try {
				if (overrides.voice !== undefined) cfg.enVoice = overrides.voice;
				if (overrides.speed !== undefined) cfg.speed = overrides.speed;
				const chunks = splitIntoChunks(text);
				return await tts.generateChunked(chunks, language, onChunk, shouldStop);
			} finally {
				cfg.enVoice = origVoice;
				cfg.speed = origSpeed;
			}
		},
		free() { tts.free(); },
	};
};

// ── Audio sink seam (so tests can run silently) ──

interface AudioSink {
	write(samples: Float32Array): void;
	end(): void;
	done: Promise<void>;
	stop(): void;
}

async function createAudioSink(sampleRate: number): Promise<AudioSink> {
	if (process.env.TELLME_TEST_SILENT === "1") {
		// Fake sink: count chunks, resolve `done` shortly after `end()`.
		let chunkCount = 0;
		let resolveDone: (() => void) | null = null;
		let stopped = false;
		const done = new Promise<void>((resolve) => { resolveDone = resolve; });
		return {
			write(_samples) {
				if (stopped) return;
				chunkCount++;
			},
			end() {
				// Tiny delay roughly proportional to chunks so queue tests can
				// observe ordering without overlapping playback.
				setTimeout(() => resolveDone?.(), Math.max(5, chunkCount * 2));
			},
			done,
			stop() {
				stopped = true;
				resolveDone?.();
			},
		};
	}

	const player = await createStreamingPlayer(sampleRate);
	if (player) return player as StreamingPlayer;

	// Fallback: buffer samples and play them all at once when end() is called.
	const buffers: Float32Array[] = [];
	let resolveDone: (() => void) | null = null;
	let rejectDone: ((err: Error) => void) | null = null;
	const done = new Promise<void>((resolve, reject) => {
		resolveDone = resolve;
		rejectDone = reject;
	});
	let handle: { stop(): void; done: Promise<void> } | null = null;
	let stopped = false;
	return {
		write(samples) { if (!stopped) buffers.push(samples); },
		end() {
			(async () => {
				try {
					const total = buffers.reduce((n, b) => n + b.length, 0);
					const merged = new Float32Array(total);
					let off = 0;
					for (const b of buffers) { merged.set(b, off); off += b.length; }
					handle = await playAudio(merged, sampleRate);
					await handle.done;
					resolveDone?.();
				} catch (err) {
					rejectDone?.(err as Error);
				}
			})();
		},
		done,
		stop() {
			stopped = true;
			handle?.stop();
			resolveDone?.();
		},
	};
}

// ── Server ──

interface QueueItem {
	req: SpeakRequest;
	socket: Socket;
	resolved: boolean;
}

export interface DaemonHandle {
	/** Resolves once the server is listening. */
	ready: Promise<void>;
	/** Stop the daemon, close the socket, unlink files. */
	stop(): Promise<void>;
}

export interface RunDaemonOptions {
	ttsFactory?: TtsFactory;
	/** When true, install SIGTERM/SIGINT handlers (production). */
	installSignalHandlers?: boolean;
}

/**
 * Start the daemon. Resolves when the daemon shuts down (matches the
 * `await runDaemon()` shape used from `__daemon-main__`).
 */
export async function runDaemon(opts: RunDaemonOptions = {}): Promise<void> {
	const handle = await startDaemon({ ...opts, installSignalHandlers: opts.installSignalHandlers ?? true });
	await new Promise<void>((resolve) => {
		(handle as any).__setExitResolve(resolve);
	});
}

/**
 * Start the daemon and return a handle. Tests call this directly so they
 * can shut it down cleanly. Production goes through `runDaemon`.
 */
export async function startDaemon(opts: RunDaemonOptions = {}): Promise<DaemonHandle> {
	const ttsFactory = opts.ttsFactory ?? defaultTtsFactory;
	const installSignals = opts.installSignalHandlers ?? false;

	ensureDaemonDir();
	const socketPath = getSocketPath();
	const pidPath = getPidPath();

	await clearStaleSocket(socketPath);

	const config = loadConfig();
	const engine = ttsFactory(config);
	await engine.init();

	const queue: QueueItem[] = [];
	let activeItem: QueueItem | null = null;
	let activeSink: AudioSink | null = null;
	let stopRequested = false;
	let shuttingDown = false;
	let exitResolve: (() => void) | null = null;

	let workerRunning = false;
	const kickWorker = () => {
		if (workerRunning) return;
		workerRunning = true;
		queueMicrotask(() => { void worker(); });
	};

	async function worker() {
		try {
			while (queue.length > 0 && !shuttingDown) {
				const item = queue.shift()!;
				activeItem = item;
				stopRequested = false;
				try {
					await processItem(item);
				} catch (err) {
					if (!item.resolved) {
						item.resolved = true;
						try {
							await writeMessage(item.socket, { kind: "error", message: (err as Error).message });
						} catch { /* ignore */ }
						item.socket.end();
					}
				}
				activeItem = null;
				activeSink = null;
			}
		} finally {
			workerRunning = false;
		}
	}

	async function processItem(item: QueueItem) {
		const reqConfig = loadConfig();
		const merged: TellMeConfig = {
			...reqConfig,
			language: item.req.lang ?? reqConfig.language,
			enVoice: item.req.voice ?? reqConfig.enVoice,
			speed: item.req.speed ?? reqConfig.speed,
		};

		let text = item.req.text;
		if (!item.req.raw) text = prepareForSpeech(text);
		if (!text.trim()) {
			if (!item.resolved) {
				item.resolved = true;
				await writeMessage(item.socket, { kind: "done", ok: true });
				item.socket.end();
			}
			return;
		}

		const language = merged.language === "auto" ? detectLanguage(text) : merged.language;
		const sampleRate = engine.getSampleRate(language);
		const sink = await createAudioSink(sampleRate);
		activeSink = sink;

		try {
			await engine.speak({
				text,
				language,
				overrides: { voice: item.req.voice, speed: item.req.speed },
				onChunk: (samples) => sink.write(samples),
				shouldStop: () => stopRequested || shuttingDown,
			});
			sink.end();
			await sink.done;
		} catch (err) {
			sink.stop();
			throw err;
		}

		if (item.resolved) return;
		item.resolved = true;
		if (stopRequested) {
			try { await writeMessage(item.socket, { kind: "stopped" }); } catch { /* ignore */ }
		} else {
			try { await writeMessage(item.socket, { kind: "done", ok: true }); } catch { /* ignore */ }
		}
		item.socket.end();
	}

	function abortActive() {
		stopRequested = true;
		activeSink?.stop();
	}

	function handleStop(stopperSocket: Socket) {
		// Snapshot pending items, drain queue.
		const pending = queue.splice(0, queue.length);
		// Mark active as stopped (worker will write `stopped` when sink resolves).
		abortActive();
		// Notify each pending request that they were dropped.
		for (const p of pending) {
			if (!p.resolved) {
				p.resolved = true;
				writeMessage(p.socket, { kind: "stopped" }).catch(() => {});
				p.socket.end();
			}
		}
		// Reply to the stopper.
		writeMessage(stopperSocket, { kind: "stopped" })
			.catch(() => {})
			.finally(() => stopperSocket.end());
	}

	function handleStatus(socket: Socket) {
		writeMessage(socket, {
			kind: "status",
			running: true,
			socketPath,
			queueDepth: queue.length + (activeItem ? 1 : 0),
			version: PROTOCOL_VERSION,
		})
			.catch(() => {})
			.finally(() => socket.end());
	}

	const server: Server = createServer((socket) => {
		void handleConnection(socket);
	});

	async function handleConnection(socket: Socket) {
		let firstMessageSeen = false;
		try {
			for await (const msg of readMessages(socket)) {
				if (!firstMessageSeen) {
					firstMessageSeen = true;
					if (typeof msg.version !== "number" || msg.version !== PROTOCOL_VERSION) {
						await writeMessage(socket, {
							kind: "version-mismatch",
							expected: PROTOCOL_VERSION,
							got: typeof msg.version === "number" ? msg.version : 0,
						});
						socket.end();
						return;
					}
				}

				if (msg.kind === "speak") {
					const item: QueueItem = { req: msg, socket, resolved: false };
					queue.push(item);
					await writeMessage(socket, { kind: "ack" });
					kickWorker();
					// Don't read more from this socket; daemon writes done/error/stopped
					// and closes.
					return;
				}

				if (msg.kind === "stop") {
					handleStop(socket);
					return;
				}

				if (msg.kind === "status") {
					handleStatus(socket);
					return;
				}

				// Unknown kind — just close.
				socket.end();
				return;
			}
		} catch {
			// connection error — make sure we don't leak the socket
			try { socket.destroy(); } catch { /* ignore */ }
		}
	}

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.off("error", reject);
			try { chmodSync(socketPath, 0o600); } catch { /* best effort */ }
			try { writeFileSync(pidPath, String(process.pid)); } catch { /* best effort */ }
			resolve();
		});
	});

	const stop = async () => {
		if (shuttingDown) return;
		shuttingDown = true;
		abortActive();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		try { if (existsSync(socketPath)) unlinkSync(socketPath); } catch { /* ignore */ }
		try { if (existsSync(pidPath)) unlinkSync(pidPath); } catch { /* ignore */ }
		try { engine.free(); } catch { /* ignore */ }
		exitResolve?.();
	};

	if (installSignals) {
		const onSig = () => { void stop().then(() => process.exit(0)); };
		process.on("SIGTERM", onSig);
		process.on("SIGINT", onSig);
	}

	const handle: DaemonHandle = {
		ready: Promise.resolve(),
		stop,
	};
	(handle as any).__setExitResolve = (fn: () => void) => { exitResolve = fn; };
	return handle;
}

/**
 * If a socket file exists at `path`, try to connect; if connect refuses
 * (no daemon listening), unlink the stale file. If connect succeeds,
 * close it and leave the file alone (caller decides what to do).
 */
async function clearStaleSocket(path: string): Promise<void> {
	if (!existsSync(path)) return;
	await new Promise<void>((resolve) => {
		const probe = createConnection(path);
		probe.once("connect", () => {
			probe.end();
			resolve();
		});
		probe.once("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
				try { unlinkSync(path); } catch { /* ignore */ }
			}
			resolve();
		});
	});
}
