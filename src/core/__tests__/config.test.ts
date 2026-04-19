import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	resolveVoiceId,
	KOKORO_VOICES,
	DEFAULT_CONFIG,
	type TellMeConfig,
} from "../config.js";

// ── resolveVoiceId ──

describe("resolveVoiceId", () => {
	it("resolves known voice names", () => {
		expect(resolveVoiceId("af")).toBe(0);
		expect(resolveVoiceId("af_bella")).toBe(1);
		expect(resolveVoiceId("am_adam")).toBe(5);
		expect(resolveVoiceId("bm_lewis")).toBe(10);
	});

	it("resolves numeric string IDs", () => {
		expect(resolveVoiceId("0")).toBe(0);
		expect(resolveVoiceId("5")).toBe(5);
		expect(resolveVoiceId("10")).toBe(10);
	});

	it("falls back to af_bella for unknown names", () => {
		expect(resolveVoiceId("unknown_voice")).toBe(KOKORO_VOICES["af_bella"]);
	});

	it("falls back to af_bella for out-of-range numbers", () => {
		expect(resolveVoiceId("99")).toBe(KOKORO_VOICES["af_bella"]);
		expect(resolveVoiceId("-1")).toBe(KOKORO_VOICES["af_bella"]);
	});

	it("falls back to af_bella for non-numeric garbage", () => {
		expect(resolveVoiceId("not_a_number")).toBe(KOKORO_VOICES["af_bella"]);
	});
});

// ── loadConfig / saveConfig ──
// These rely on file I/O at ~/.tellme/config.json. We test them
// with a temporary directory by dynamically patching the module.
// Since the CONFIG_PATH is a const, we test the behavior indirectly:
// loadConfig returns defaults when file is absent, and saveConfig
// doesn't throw.

describe("loadConfig", () => {
	it("returns config with correct shape and valid values", async () => {
		const { loadConfig } = await import("../config.js");
		const config = loadConfig();

		// Language must be one of the valid options
		expect(["auto", "en", "pl"]).toContain(config.language);
		// Voice must be a known Kokoro voice
		expect(config.enVoice in KOKORO_VOICES).toBe(true);
		// Speed must be in valid range
		expect(config.speed).toBeGreaterThanOrEqual(0.5);
		expect(config.speed).toBeLessThanOrEqual(2.0);
		// Boolean
		expect(typeof config.autoRead).toBe("boolean");
		// Shortcuts present
		expect(config.shortcuts).toBeDefined();
		expect(typeof config.shortcuts.speak).toBe("string");
		expect(typeof config.shortcuts.clipboard).toBe("string");
		// modelsDir present
		expect(config.modelsDir).toContain(".tellme");
	});

	it("returns a separate shortcuts object — never the DEFAULT_CONFIG reference", async () => {
		const { loadConfig, DEFAULT_CONFIG } = await import("../config.js");
		const config = loadConfig();
		expect(config.shortcuts).not.toBe(DEFAULT_CONFIG.shortcuts);
	});

	it("does not mutate DEFAULT_CONFIG.shortcuts", async () => {
		const { loadConfig, DEFAULT_CONFIG } = await import("../config.js");
		const originalSpeak = DEFAULT_CONFIG.shortcuts.speak;
		const originalClipboard = DEFAULT_CONFIG.shortcuts.clipboard;

		// Call loadConfig — must not mutate the module-level constant
		loadConfig();

		expect(DEFAULT_CONFIG.shortcuts.speak).toBe(originalSpeak);
		expect(DEFAULT_CONFIG.shortcuts.clipboard).toBe(originalClipboard);
	});

	it("returns independent configs on successive calls", async () => {
		const { loadConfig } = await import("../config.js");
		const a = loadConfig();
		const b = loadConfig();

		// Mutating one must not affect the other
		a.shortcuts.speak = "__test__";
		expect(b.shortcuts.speak).not.toBe("__test__");
	});
});

describe("DEFAULT_CONFIG", () => {
	it("has valid defaults", () => {
		expect(DEFAULT_CONFIG.language).toBe("auto");
		expect(DEFAULT_CONFIG.enVoice).toBe("af_bella");
		expect(DEFAULT_CONFIG.speed).toBeGreaterThanOrEqual(0.5);
		expect(DEFAULT_CONFIG.speed).toBeLessThanOrEqual(2.0);
		expect(DEFAULT_CONFIG.autoRead).toBe(false);
	});

	it("has modelsDir in home directory", () => {
		expect(DEFAULT_CONFIG.modelsDir).toContain(".tellme");
		expect(DEFAULT_CONFIG.modelsDir).toContain("models");
	});
});

describe("KOKORO_VOICES", () => {
	it("contains all expected voices", () => {
		const expected = [
			"af", "af_bella", "af_nicole", "af_sarah", "af_sky",
			"am_adam", "am_michael",
			"bf_emma", "bf_isabella",
			"bm_george", "bm_lewis",
		];
		for (const voice of expected) {
			expect(KOKORO_VOICES).toHaveProperty(voice);
			expect(typeof KOKORO_VOICES[voice]).toBe("number");
		}
	});

	it("has unique numeric IDs", () => {
		const ids = Object.values(KOKORO_VOICES);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("has IDs from 0 to 10", () => {
		const ids = Object.values(KOKORO_VOICES);
		expect(Math.min(...ids)).toBe(0);
		expect(Math.max(...ids)).toBe(10);
	});
});
