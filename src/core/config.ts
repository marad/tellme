import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface TellMeConfig {
	/** Directory for cached models */
	modelsDir: string;
	/** Language detection mode: "auto" | "en" | "pl" */
	language: "auto" | "en" | "pl";
	/** English voice (Kokoro speaker name) */
	enVoice: string;
	/** Polish voice model variant */
	plModel: "meski_wg_glos-medium" | "justyna_wg_glos-medium";
	/** Speech speed (0.5 - 2.0) */
	speed: number;
	/** Auto-read assistant messages in Pi extension */
	autoRead: boolean;
}

export const DEFAULT_CONFIG: TellMeConfig = {
	modelsDir: join(homedir(), ".tellme", "models"),
	language: "auto",
	enVoice: "af_bella",
	plModel: "meski_wg_glos-medium",
	speed: 1.0,
	autoRead: false,
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
