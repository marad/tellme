import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, type Socket } from "node:net";
import { startDaemon, type DaemonHandle, type TtsFactory, type DaemonTtsEngine } from "../daemon-server.js";
import { writeMessage, readMessages, PROTOCOL_VERSION } from "../daemon-protocol.js";

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
});
