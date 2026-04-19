import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";

export interface TellMeConfig {
	/** Directory for cached models */
	modelsDir: string;
	/** Language detection mode: "auto" | "en" | "pl" */
	language: "auto" | "en" | "pl";
	/** English voice (Kokoro speaker name) */
	enVoice: string;
	/** Polish voice (Piper speaker variant) */
	plVoice: "meski_wg_glos-medium" | "justyna_wg_glos-medium";
	/** Speech speed (0.5 - 2.0) */
	speed: number;
	/** Auto-read assistant messages in Pi extension */
	autoRead: boolean;
	/** Keyboard shortcuts (Pi extension) */
	shortcuts: {
		/** Speak / stop last assistant message */
		speak: string;
		/** Read clipboard aloud */
		clipboard: string;
	};
}

export const DEFAULT_CONFIG: TellMeConfig = {
	modelsDir: join(homedir(), ".tellme", "models"),
	language: "auto",
	enVoice: "af_bella",
	plVoice: "meski_wg_glos-medium",
	speed: 1.0,
	autoRead: false,
	shortcuts: {
		speak: "ctrl+shift+s",
		clipboard: "ctrl+shift+r",
	},
};

export const KOKORO_MODEL = {
	name: "kokoro-en-v0_19",
	url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2",
	sizeBytes: 319_000_000,
	files: {
		model: "model.onnx",
		voices: "voices.bin",
		tokens: "tokens.txt",
		dataDir: "espeak-ng-data",
	},
};

/**
 * Kokoro EN v0.19 voices.
 * a = American, b = British; f = female, m = male.
 */
export const KOKORO_VOICES: Record<string, number> = {
	af: 0,
	af_bella: 1,
	af_nicole: 2,
	af_sarah: 3,
	af_sky: 4,
	am_adam: 5,
	am_michael: 6,
	bf_emma: 7,
	bf_isabella: 8,
	bm_george: 9,
	bm_lewis: 10,
};

export const PIPER_PL_MODELS: Record<string, { url: string; onnxFile: string; label: string }> = {
	"meski_wg_glos-medium": {
		url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-pl_PL-meski_wg_glos-medium.tar.bz2",
		onnxFile: "pl_PL-meski_wg_glos-medium.onnx",
		label: "Męski (wg głos)",
	},
	"justyna_wg_glos-medium": {
		url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-pl_PL-justyna_wg_glos-medium.tar.bz2",
		onnxFile: "pl_PL-justyna_wg_glos-medium.onnx",
		label: "Justyna (wg głos)",
	},
};

export function resolveVoiceId(name: string): number {
	if (name in KOKORO_VOICES) return KOKORO_VOICES[name];
	const asNum = parseInt(name, 10);
	if (!isNaN(asNum) && asNum >= 0 && asNum <= 10) return asNum;
	return KOKORO_VOICES["af_bella"]; // fallback
}

export function isLinux(): boolean {
	return platform() === "linux";
}

export function isMac(): boolean {
	return platform() === "darwin";
}

// --- Global config persistence (~/.tellme/config.json) ---

const CONFIG_PATH = join(homedir(), ".tellme", "config.json");

/** User-facing config keys that get persisted */
type PersistableKeys = "language" | "enVoice" | "plVoice" | "speed" | "autoRead" | "shortcuts";
const PERSISTABLE: PersistableKeys[] = ["language", "enVoice", "plVoice", "speed", "autoRead", "shortcuts"];

/**
 * Load config from ~/.tellme/config.json merged over defaults.
 * Invalid or missing file → returns defaults.
 */
export function loadConfig(): TellMeConfig {
	const config = { ...DEFAULT_CONFIG, shortcuts: { ...DEFAULT_CONFIG.shortcuts } };
	try {
		if (existsSync(CONFIG_PATH)) {
			const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
			if (raw.language === "auto" || raw.language === "en" || raw.language === "pl") config.language = raw.language;
			if (typeof raw.enVoice === "string" && raw.enVoice in KOKORO_VOICES) config.enVoice = raw.enVoice;
			if (typeof raw.plVoice === "string" && raw.plVoice in PIPER_PL_MODELS) config.plVoice = raw.plVoice;
			else if (typeof raw.plModel === "string" && raw.plModel in PIPER_PL_MODELS) config.plVoice = raw.plModel;
			if (typeof raw.speed === "number" && raw.speed >= 0.5 && raw.speed <= 2.0) config.speed = raw.speed;
			if (typeof raw.autoRead === "boolean") config.autoRead = raw.autoRead;
			if (raw.shortcuts && typeof raw.shortcuts === "object") {
				if (typeof raw.shortcuts.speak === "string") config.shortcuts.speak = raw.shortcuts.speak;
				if (typeof raw.shortcuts.clipboard === "string") config.shortcuts.clipboard = raw.shortcuts.clipboard;
			}
		}
	} catch {
		// ignore corrupt file
	}
	return config;
}

/**
 * Save user preferences to ~/.tellme/config.json.
 * Only persists user-facing keys, not modelsDir.
 */
export function saveConfig(config: TellMeConfig): void {
	try {
		const dir = dirname(CONFIG_PATH);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const data: Record<string, unknown> = {};
		for (const key of PERSISTABLE) data[key] = config[key];
		writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + "\n");
	} catch {
		// best-effort
	}
}
