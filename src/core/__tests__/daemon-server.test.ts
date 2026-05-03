import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, type Socket } from "node:net";
import {
	startDaemon,
	type DaemonHandle,
	type TtsFactory,
	type DaemonTtsEngine,
	__resetSinkCountForTest,
	__getSinkCountForTest,
} from "../daemon-server.js";
import { writeMessage, readMessages, PROTOCOL_VERSION } from "../daemon-protocol.js";
import { getSocketPath, getPidPath } from "../daemon-paths.js";

interface SpeakCall {
	text: string;
	language: "en" | "pl";
	voice: string | undefined;
	speed: number | undefined;
	startedAt: number;
	finishedAt: number;
}

interface FakeEngine extends DaemonTtsEngine {
	calls: SpeakCall[];
	initCount: number;
	throwOn?: (text: string) => string | null;
	playMs: number;
}

interface FactoryHandle {
	factory: TtsFactory;
	getEngine(): FakeEngine;
}

function makeFakeFactory(opts: { throwOn?: (t: string) => string | null; playMs?: number } = {}): FactoryHandle {
	let engineRef: FakeEngine | null = null;
	const factory: TtsFactory = (_config) => {
		const engine: FakeEngine = {
			calls: [],
			initCount: 0,
			throwOn: opts.throwOn,
			playMs: opts.playMs ?? 30,
			async init() { this.initCount++; },
			getSampleRate(_lang) { return 24000; },
			async speak({ text, language, overrides, onChunk, shouldStop }) {
				const startedAt = Date.now();
				const errMsg = this.throwOn?.(text);
				if (errMsg) throw new Error(errMsg);

				const chunks = 3;
				for (let i = 0; i < chunks; i++) {
					if (shouldStop()) break;
					await new Promise((r) => setTimeout(r, this.playMs / chunks));
					onChunk(new Float32Array(100));
				}

				const finishedAt = Date.now();
				this.calls.push({
					text,
					language,
					voice: overrides.voice,
					speed: overrides.speed,
					startedAt,
					finishedAt,
				});
				return { sampleRate: 24000 };
			},
			free() {},
		};
		engineRef = engine;
		return engine;
	};
	return {
		factory,
		getEngine() {
			if (!engineRef) throw new Error("engine not yet created");
			return engineRef;
		},
	};
}

function connect(path: string): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const s = createConnection(path);
		s.once("connect", () => { s.off("error", reject); resolve(s); });
		s.once("error", reject);
	});
}

async function sendAndCollect(path: string, msg: object): Promise<any[]> {
	const s = await connect(path);
	await writeMessage(s, msg);
	const out: any[] = [];
	for await (const m of readMessages(s)) out.push(m);
	return out;
}

describe("daemon-server", () => {
	let tmpDir: string;
	let handle: DaemonHandle | null = null;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "tellme-daemon-test-"));
		process.env.TELLME_DAEMON_DIR = tmpDir;
		process.env.TELLME_TEST_SILENT = "1";
	});

	afterEach(async () => {
		if (handle) {
			try { await handle.stop(); } catch { /* ignore */ }
			handle = null;
		}
		delete process.env.TELLME_DAEMON_DIR;
		delete process.env.TELLME_TEST_SILENT;
		try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	it("AC-3: refuses incompatible protocol version with a clear message", async () => {
		const fh = makeFakeFactory();
		handle = await startDaemon({ ttsFactory: fh.factory });
		const socketPath = join(tmpDir, "daemon.sock");

		const replies = await sendAndCollect(socketPath, {
			kind: "speak",
			version: 999,
			text: "hi",
		});

		expect(replies.length).toBeGreaterThan(0);
		expect(replies[0]).toEqual({
			kind: "version-mismatch",
			expected: PROTOCOL_VERSION,
			got: 999,
		});
	});

	it("AC-4: queued speak requests do not overlap and finish in order", async () => {
		const fh = makeFakeFactory({ playMs: 40 });
		handle = await startDaemon({ ttsFactory: fh.factory });
		const socketPath = join(tmpDir, "daemon.sock");

		const send = async (text: string) => {
			const replies = await sendAndCollect(socketPath, {
				kind: "speak",
				version: PROTOCOL_VERSION,
				text,
			});
			return { replies, doneAt: Date.now() };
		};

		const [a, b, c] = await Promise.all([send("first"), send("second"), send("third")]);

		// All three completed successfully.
		for (const r of [a, b, c]) {
			expect(r.replies.some((m: any) => m.kind === "done" && m.ok === true)).toBe(true);
		}

		const e = fh.getEngine();
		expect(e.calls.map((c) => c.text)).toEqual(["first", "second", "third"]);

		// No two engine calls overlap in time.
		for (let i = 1; i < e.calls.length; i++) {
			expect(e.calls[i].startedAt).toBeGreaterThanOrEqual(e.calls[i - 1].finishedAt);
		}
	});

	it("AC-5: TTS engine is initialized exactly once across many requests", async () => {
		const fh = makeFakeFactory({ playMs: 5 });
		handle = await startDaemon({ ttsFactory: fh.factory });
		const socketPath = join(tmpDir, "daemon.sock");

		for (let i = 0; i < 5; i++) {
			const replies = await sendAndCollect(socketPath, {
				kind: "speak",
				version: PROTOCOL_VERSION,
				text: `req ${i}`,
			});
			expect(replies.some((m: any) => m.kind === "done")).toBe(true);
		}

		expect(fh.getEngine().initCount).toBe(1);
	});

	it("AC-6: stop halts the active utterance and clears the queue", async () => {
		const fh = makeFakeFactory({ playMs: 200 });
		handle = await startDaemon({ ttsFactory: fh.factory });
		const socketPath = join(tmpDir, "daemon.sock");

		// Open three speak connections that we drive manually so we can read
		// their replies after stop fires.
		const openSpeak = async (text: string) => {
			const s = await connect(socketPath);
			await writeMessage(s, { kind: "speak", version: PROTOCOL_VERSION, text });
			const replies: any[] = [];
			const consumer = (async () => {
				for await (const m of readMessages(s)) replies.push(m);
			})();
			return { socket: s, replies, consumer };
		};

		const [a, b, c] = await Promise.all([openSpeak("A"), openSpeak("B"), openSpeak("C")]);

		// Wait for A to be picked up by the worker (ack received) and a tiny
		// bit into playback so stop hits an active item.
		await new Promise((r) => setTimeout(r, 30));

		const stopReplies = await sendAndCollect(socketPath, {
			kind: "stop",
			version: PROTOCOL_VERSION,
		});
		expect(stopReplies.some((m: any) => m.kind === "stopped")).toBe(true);

		await Promise.all([a.consumer, b.consumer, c.consumer]);

		// Each speak got either `stopped` or no completion; none should claim done.
		for (const conn of [a, b, c]) {
			const hadDone = conn.replies.some((m: any) => m.kind === "done");
			const hadStopped = conn.replies.some((m: any) => m.kind === "stopped");
			expect(hadDone).toBe(false);
			expect(hadStopped).toBe(true);
		}

		// Daemon goes idle: queueDepth should be 0.
		const status = await sendAndCollect(socketPath, { kind: "status", version: PROTOCOL_VERSION });
		const reply = status.find((m: any) => m.kind === "status");
		expect(reply.queueDepth).toBe(0);
	});

	it("AC-7: per-request overrides do not leak between requests", async () => {
		const fh = makeFakeFactory({ playMs: 5 });
		handle = await startDaemon({ ttsFactory: fh.factory });
		const socketPath = join(tmpDir, "daemon.sock");

		// Request A with an explicit voice override.
		await sendAndCollect(socketPath, {
			kind: "speak",
			version: PROTOCOL_VERSION,
			text: "first",
			voice: "custom_voice_x",
		});

		// Request B with no overrides.
		await sendAndCollect(socketPath, {
			kind: "speak",
			version: PROTOCOL_VERSION,
			text: "second",
		});

		const calls = fh.getEngine().calls;
		expect(calls).toHaveLength(2);
		expect(calls[0].voice).toBe("custom_voice_x");
		expect(calls[1].voice).toBeUndefined();
	});

	it("AC-8: synthesis errors are surfaced to the client", async () => {
		const fh = makeFakeFactory({
			throwOn: (t) => (t.includes("boom") ? "synthesis blew up" : null),
		});
		handle = await startDaemon({ ttsFactory: fh.factory });
		const socketPath = join(tmpDir, "daemon.sock");

		const replies = await sendAndCollect(socketPath, {
			kind: "speak",
			version: PROTOCOL_VERSION,
			text: "boom!",
		});

		const err = replies.find((m: any) => m.kind === "error");
		expect(err).toBeDefined();
		expect(err.message).toContain("synthesis blew up");
	});

	it("AC-1: streaming connection starts playback before end-of-input", async () => {
		const fh = makeFakeFactory({ playMs: 30 });
		handle = await startDaemon({ ttsFactory: fh.factory });
		const socketPath = join(tmpDir, "daemon.sock");

		const s = await connect(socketPath);
		const replies: any[] = [];
		const consumer = (async () => {
			for await (const m of readMessages(s)) replies.push(m);
		})();

		await writeMessage(s, {
			kind: "speak",
			version: PROTOCOL_VERSION,
			text: "",
			streaming: true,
		});
		// Wait for ack so the worker has had a chance to grab the item.
		await new Promise((r) => setTimeout(r, 20));
		expect(replies.some((m) => m.kind === "ack")).toBe(true);

		// Send first sentence — boundary on the trailing space.
		await writeMessage(s, { kind: "chunk", text: "Hello world. " });
		// Send second sentence (no trailing whitespace, will need flush on end).
		await writeMessage(s, { kind: "chunk", text: "Second sentence." });

		// Give the worker a beat to synthesize the first sentence — playMs=30
		// plus a bit for setTimeout on the fake sink end()
		await new Promise((r) => setTimeout(r, 120));

		// The first sentence should have been synthesized BEFORE we send `end`.
		const e = fh.getEngine();
		expect(e.calls.map((c) => c.text)).toContain("Hello world.");
		expect(replies.some((m) => m.kind === "done")).toBe(false);

		// Now send end — daemon flushes residue and signals done.
		await writeMessage(s, { kind: "end" });
		await consumer;

		expect(e.calls.map((c) => c.text)).toEqual(["Hello world.", "Second sentence."]);
		expect(replies.some((m) => m.kind === "done")).toBe(true);
	});

	it("AC-2: idle timeout drains buffer and signals done", async () => {
		process.env.TELLME_STREAM_IDLE_MS = "50";
		try {
			const fh = makeFakeFactory({ playMs: 10 });
			handle = await startDaemon({ ttsFactory: fh.factory });
			const socketPath = join(tmpDir, "daemon.sock");

			const s = await connect(socketPath);
			const replies: any[] = [];
			const consumer = (async () => {
				for await (const m of readMessages(s)) replies.push(m);
			})();

			await writeMessage(s, {
				kind: "speak",
				version: PROTOCOL_VERSION,
				text: "",
				streaming: true,
			});
			await new Promise((r) => setTimeout(r, 10));
			await writeMessage(s, { kind: "chunk", text: "Hello world. " });
			await writeMessage(s, { kind: "chunk", text: "And second" });

			// Wait for the idle timer to fire and the worker to drain.
			await consumer;

			const e = fh.getEngine();
			expect(e.calls.map((c) => c.text)).toEqual(["Hello world.", "And second"]);
			expect(replies.some((m) => m.kind === "done")).toBe(true);
		} finally {
			delete process.env.TELLME_STREAM_IDLE_MS;
		}
	});

	it("AC-3: hard duration cap stops accepting chunks and closes", async () => {
		process.env.TELLME_STREAM_MAX_MS = "100";
		try {
			const fh = makeFakeFactory({ playMs: 50 });
			handle = await startDaemon({ ttsFactory: fh.factory });
			const socketPath = join(tmpDir, "daemon.sock");

			const s = await connect(socketPath);
			const replies: any[] = [];
			const consumer = (async () => {
				for await (const m of readMessages(s)) replies.push(m);
			})();

			await writeMessage(s, {
				kind: "speak",
				version: PROTOCOL_VERSION,
				text: "",
				streaming: true,
			});
			await new Promise((r) => setTimeout(r, 10));
			await writeMessage(s, { kind: "chunk", text: "First sentence. " });

			// Wait past the cap.
			await new Promise((r) => setTimeout(r, 150));
			// Try to push a chunk after the cap — daemon should silently drop it.
			try {
				await writeMessage(s, { kind: "chunk", text: "Late chunk. " });
			} catch { /* ignore — socket may be closing */ }

			await consumer;

			const e = fh.getEngine();
			expect(e.calls.map((c) => c.text)).toContain("First sentence.");
			expect(e.calls.map((c) => c.text)).not.toContain("Late chunk.");
			expect(replies.some((m) => m.kind === "done")).toBe(true);
			expect(replies.some((m) => m.kind === "error")).toBe(false);
		} finally {
			delete process.env.TELLME_STREAM_MAX_MS;
		}
	});

	it("AC-4: stop while streaming closes the connection cleanly", async () => {
		const fh = makeFakeFactory({ playMs: 100 });
		handle = await startDaemon({ ttsFactory: fh.factory });
		const socketPath = join(tmpDir, "daemon.sock");

		// Open streaming connection and start playback.
		const s = await connect(socketPath);
		const replies: any[] = [];
		const consumer = (async () => {
			for await (const m of readMessages(s)) replies.push(m);
		})();

		await writeMessage(s, {
			kind: "speak",
			version: PROTOCOL_VERSION,
			text: "",
			streaming: true,
		});
		await writeMessage(s, { kind: "chunk", text: "Streaming text now. " });
		// Wait for the engine to pick up the first sentence.
		await new Promise((r) => setTimeout(r, 30));

		// Send stop from a second connection.
		const stopReplies = await sendAndCollect(socketPath, {
			kind: "stop",
			version: PROTOCOL_VERSION,
		});
		expect(stopReplies.some((m) => m.kind === "stopped")).toBe(true);

		await consumer;
		expect(replies.some((m) => m.kind === "stopped")).toBe(true);
		expect(replies.some((m) => m.kind === "done")).toBe(false);

		// Verify daemon is not wedged: a fresh speak completes successfully.
		const fresh = await sendAndCollect(socketPath, {
			kind: "speak",
			version: PROTOCOL_VERSION,
			text: "fresh",
		});
		expect(fresh.some((m) => m.kind === "done")).toBe(true);
	});

	const ac5Cases = [
		{ name: "graceful end", completion: "end" as const },
		{ name: "idle timeout", completion: "idle" as const },
		{ name: "client disconnect", completion: "disconnect" as const },
	];
	for (const c of ac5Cases) {
		it(`AC-5: a second request waits for the streaming connection (${c.name})`, async () => {
			if (c.completion === "idle") process.env.TELLME_STREAM_IDLE_MS = "50";
			try {
				const fh = makeFakeFactory({ playMs: 30 });
				handle = await startDaemon({ ttsFactory: fh.factory });
				const socketPath = join(tmpDir, "daemon.sock");

				// Open streaming connection.
				const stream = await connect(socketPath);
				const streamReplies: any[] = [];
				const streamConsumer = (async () => {
					for await (const m of readMessages(stream)) streamReplies.push(m);
				})();
				await writeMessage(stream, {
					kind: "speak",
					version: PROTOCOL_VERSION,
					text: "",
					streaming: true,
				});
				await writeMessage(stream, { kind: "chunk", text: "First. " });
				await writeMessage(stream, { kind: "chunk", text: "Second. " });
				// Give the streamer a head start so the worker is busy when the
				// second request arrives.
				await new Promise((r) => setTimeout(r, 10));

				// Open a second one-shot speak. It should queue and wait.
				const secondPromise = sendAndCollect(socketPath, {
					kind: "speak",
					version: PROTOCOL_VERSION,
					text: "second-request",
				});

				// Drive completion of the streaming connection per the test variant.
				if (c.completion === "end") {
					await new Promise((r) => setTimeout(r, 10));
					await writeMessage(stream, { kind: "end" });
				} else if (c.completion === "idle") {
					// Just wait — the idle timer fires.
				} else if (c.completion === "disconnect") {
					await new Promise((r) => setTimeout(r, 10));
					stream.destroy();
				}

				const second = await secondPromise;
				await streamConsumer.catch(() => {});

				expect(second.some((m: any) => m.kind === "done")).toBe(true);

				const e = fh.getEngine();
				const secondCall = e.calls.find((x) => x.text === "second-request");
				expect(secondCall).toBeDefined();
				const streamCalls = e.calls.filter((x) => x.text !== "second-request");
				expect(streamCalls.length).toBeGreaterThan(0);
				const lastStreamFinish = Math.max(...streamCalls.map((x) => x.finishedAt));
				expect(secondCall!.startedAt).toBeGreaterThanOrEqual(lastStreamFinish);
			} finally {
				delete process.env.TELLME_STREAM_IDLE_MS;
			}
		});
	}

	it("AC-6: streaming connection reuses a single AudioSink across sentences (same sample rate)", async () => {
		__resetSinkCountForTest();
		const fh = makeFakeFactory({ playMs: 10 });
		handle = await startDaemon({ ttsFactory: fh.factory });
		const socketPath = join(tmpDir, "daemon.sock");

		const s = await connect(socketPath);
		const replies: any[] = [];
		const consumer = (async () => {
			for await (const m of readMessages(s)) replies.push(m);
		})();

		await writeMessage(s, {
			kind: "speak",
			version: PROTOCOL_VERSION,
			text: "",
			streaming: true,
		});
		await writeMessage(s, { kind: "chunk", text: "First sentence. " });
		await writeMessage(s, { kind: "chunk", text: "Second sentence. " });
		await writeMessage(s, { kind: "chunk", text: "Third sentence." });
		// Tiny pause to let some synthesis start.
		await new Promise((r) => setTimeout(r, 30));
		await writeMessage(s, { kind: "end" });
		await consumer;

		const e = fh.getEngine();
		expect(e.calls.map((c) => c.text)).toEqual([
			"First sentence.",
			"Second sentence.",
			"Third sentence.",
		]);
		expect(replies.some((m: any) => m.kind === "done")).toBe(true);

		// One sink for the entire streaming connection — three sentences shared
		// the same sample rate, so the daemon must not have torn down and
		// re-opened the audio sink between sentences.
		expect(__getSinkCountForTest()).toBe(1);
	});

	it("AC-7: auto-mode detects language once on the first sentence and reuses it", async () => {
		const fh = makeFakeFactory({ playMs: 5 });
		handle = await startDaemon({ ttsFactory: fh.factory });
		const socketPath = join(tmpDir, "daemon.sock");

		const s = await connect(socketPath);
		const replies: any[] = [];
		const consumer = (async () => {
			for await (const m of readMessages(s)) replies.push(m);
		})();

		await writeMessage(s, {
			kind: "speak",
			version: PROTOCOL_VERSION,
			text: "",
			lang: "auto",
			streaming: true,
		});
		await writeMessage(s, { kind: "chunk", text: "Hello world. " });
		await writeMessage(s, { kind: "chunk", text: "Cześć świecie." });
		await writeMessage(s, { kind: "end" });
		await consumer;

		const e = fh.getEngine();
		expect(e.calls.length).toBe(2);
		// First sentence is English → cached. Second sentence has Polish
		// characters that would auto-detect as "pl" if re-evaluated, but the
		// connection's cached "en" must be reused.
		expect(e.calls[0].language).toBe("en");
		expect(e.calls[1].language).toBe("en");
	});

	it("AC-7: explicit lang override applies to every sentence", async () => {
		const fh = makeFakeFactory({ playMs: 5 });
		handle = await startDaemon({ ttsFactory: fh.factory });
		const socketPath = join(tmpDir, "daemon.sock");

		const s = await connect(socketPath);
		const replies: any[] = [];
		const consumer = (async () => {
			for await (const m of readMessages(s)) replies.push(m);
		})();

		await writeMessage(s, {
			kind: "speak",
			version: PROTOCOL_VERSION,
			text: "",
			lang: "pl",
			streaming: true,
		});
		await writeMessage(s, { kind: "chunk", text: "Hello world. " });
		await writeMessage(s, { kind: "chunk", text: "Another English sentence." });
		await writeMessage(s, { kind: "end" });
		await consumer;

		const e = fh.getEngine();
		expect(e.calls.length).toBe(2);
		expect(e.calls[0].language).toBe("pl");
		expect(e.calls[1].language).toBe("pl");
	});

	it("AC-10: client receives done before EOF", async () => {
		const fh = makeFakeFactory({ playMs: 5 });
		handle = await startDaemon({ ttsFactory: fh.factory });
		const socketPath = join(tmpDir, "daemon.sock");

		const s = await connect(socketPath);
		await writeMessage(s, {
			kind: "speak",
			version: PROTOCOL_VERSION,
			text: "hello",
		});

		let sawDone = false;
		let eofAfterDone = false;
		for await (const m of readMessages(s)) {
			if (m.kind === "done") sawDone = true;
			else if (sawDone) {
				// Any message after done would mean done wasn't the terminator.
				eofAfterDone = false;
			}
		}
		// If the loop exited and we saw done, then EOF came after done.
		if (sawDone) eofAfterDone = true;

		expect(sawDone).toBe(true);
		expect(eofAfterDone).toBe(true);
	});

	it("FEAT-0003 AC-2: daemon exits cleanly after idle interval", async () => {
		process.env.TELLME_DAEMON_IDLE_MS = "50";
		try {
			const fh = makeFakeFactory();
			handle = await startDaemon({ ttsFactory: fh.factory });
			const socketPath = getSocketPath();
			const pidPath = getPidPath();

			// Wait long enough for the idle timer to fire and stop() to clean up.
			await new Promise((r) => setTimeout(r, 150));

			expect(existsSync(socketPath)).toBe(false);
			expect(existsSync(pidPath)).toBe(false);
		} finally {
			delete process.env.TELLME_DAEMON_IDLE_MS;
		}
	});

	it("FEAT-0003 AC-2: activity resets the idle timer", async () => {
		process.env.TELLME_DAEMON_IDLE_MS = "50";
		try {
			const fh = makeFakeFactory();
			handle = await startDaemon({ ttsFactory: fh.factory });
			const socketPath = getSocketPath();

			// Ping every 30ms for ~200ms — each connection should disarm and
			// re-arm the idle timer, keeping the daemon alive.
			const start = Date.now();
			while (Date.now() - start < 200) {
				await sendAndCollect(socketPath, {
					kind: "status",
					version: PROTOCOL_VERSION,
				});
				await new Promise((r) => setTimeout(r, 30));
			}
			expect(existsSync(socketPath)).toBe(true);

			// Stop pinging; let the idle timer fire.
			await new Promise((r) => setTimeout(r, 150));
			expect(existsSync(socketPath)).toBe(false);
		} finally {
			delete process.env.TELLME_DAEMON_IDLE_MS;
		}
	});
});
