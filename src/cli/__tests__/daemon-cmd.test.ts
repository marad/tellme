import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDaemonRunning } from "../daemon-cmd.js";
import {
	startDaemon,
	type DaemonHandle,
	type TtsFactory,
	type DaemonTtsEngine,
} from "../../core/daemon-server.js";

interface FakeEngine extends DaemonTtsEngine {
	initCount: number;
}

interface FactoryHandle {
	factory: TtsFactory;
}

function makeFakeFactory(): FactoryHandle {
	const factory: TtsFactory = (_config) => {
		const engine: FakeEngine = {
			initCount: 0,
			async init() { this.initCount++; },
			getSampleRate(_lang) { return 24000; },
			async speak({ onChunk, shouldStop }) {
				if (shouldStop()) return { sampleRate: 24000 };
				onChunk(new Float32Array(100));
				return { sampleRate: 24000 };
			},
			free() {},
		};
		return engine;
	};
	return { factory };
}

describe("ensureDaemonRunning", () => {
	it("FEAT-0003 AC-1: spawns and reaches readiness via injected spawner", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "tellme-ensure-test-"));
		process.env.TELLME_DAEMON_DIR = tmpDir;
		process.env.TELLME_TEST_SILENT = "1";

		let spawnedHandle: DaemonHandle | null = null;
		try {
			const fh = makeFakeFactory();
			const ok = await ensureDaemonRunning({
				spawner: () => {
					void startDaemon({ ttsFactory: fh.factory, installSignalHandlers: false }).then((h) => {
						spawnedHandle = h;
					});
				},
				waitMs: 3000,
			});
			expect(ok).toBe(true);

			// Already-running short-circuit: second call must return true immediately
			// without re-spawning.
			const ok2 = await ensureDaemonRunning({
				spawner: () => { throw new Error("should not be called"); },
			});
			expect(ok2).toBe(true);
		} finally {
			if (spawnedHandle) {
				try { await (spawnedHandle as DaemonHandle).stop(); } catch { /* ignore */ }
			}
			delete process.env.TELLME_DAEMON_DIR;
			delete process.env.TELLME_TEST_SILENT;
			try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
		}
	});
});
