/**
 * TTS Engine — unified interface over Kokoro (EN) and Piper (PL).
 * Uses sherpa-onnx-node for both backends.
 */

import { resolveVoiceId, type TellMeConfig } from "./config.js";
import { getKokoroPaths, getPiperPlPaths } from "./model-manager.js";
import type { DetectedLanguage } from "./language-detect.js";

// sherpa-onnx-node loaded dynamically to handle optional dep
let sherpa: any = null;

async function getSherpa() {
	if (!sherpa) {
		const mod = await import("sherpa-onnx-node");
		sherpa = mod.default ?? mod;
	}
	return sherpa;
}

export interface TtsResult {
	samples: Float32Array;
	sampleRate: number;
}

export interface TtsInstance {
	sampleRate: number;
	generate(text: string, speed?: number, speakerId?: number): Float32Array;
	free(): void;
}

/** Create a Kokoro TTS instance for English */
export async function createKokoroTts(config: TellMeConfig): Promise<TtsInstance> {
	const paths = getKokoroPaths(config);
	if (!paths) throw new Error("Kokoro model not downloaded. Run: tellme --download");

	const s = await getSherpa();

	const tts = new s.OfflineTts({
		model: {
			kokoro: {
				model: paths.model,
				voices: paths.voices,
				tokens: paths.tokens,
				dataDir: paths.dataDir,
			},
			debug: false,
			numThreads: 2,
			provider: "cpu",
		},
		maxNumSentences: 1,
	});

	return {
		sampleRate: tts.sampleRate,
		generate(text: string, speed = config.speed, speakerId?: number): Float32Array {
			const sid = speakerId ?? resolveVoiceId(config.enVoice);
			const generationConfig = new s.GenerationConfig({ sid, speed });
			const audio = tts.generate({ text, generationConfig });
			return audio.samples;
		},
		free() {},
	};
}

/** Create a Piper TTS instance for Polish */
export async function createPiperTts(config: TellMeConfig): Promise<TtsInstance> {
	const paths = getPiperPlPaths(config);
	if (!paths) throw new Error("Piper PL model not downloaded. Run: tellme --download");

	const s = await getSherpa();

	const tts = new s.OfflineTts({
		model: {
			vits: {
				model: paths.model,
				tokens: paths.tokens,
				dataDir: paths.dataDir,
			},
			debug: false,
			numThreads: 2,
			provider: "cpu",
		},
		maxNumSentences: 2,
	});

	return {
		sampleRate: tts.sampleRate,
		generate(text: string, speed = config.speed): Float32Array {
			const generationConfig = new s.GenerationConfig({ sid: 0, speed });
			const audio = tts.generate({ text, generationConfig });
			return audio.samples;
		},
		free() {},
	};
}

/**
 * Dual-engine TTS — auto-selects Kokoro (EN) or Piper (PL) based on language.
 */
export class TellMeTts {
	private kokoroTts: TtsInstance | null = null;
	private piperTts: TtsInstance | null = null;
	private config: TellMeConfig;

	constructor(config: TellMeConfig) {
		this.config = config;
	}

	async init(): Promise<void> {
		const [kokoro, piper] = await Promise.allSettled([
			createKokoroTts(this.config),
			createPiperTts(this.config),
		]);

		if (kokoro.status === "fulfilled") this.kokoroTts = kokoro.value;
		if (piper.status === "fulfilled") this.piperTts = piper.value;

		if (!this.kokoroTts && !this.piperTts) {
			throw new Error("No TTS models available. Run: tellme --download");
		}
	}

	private getEngine(language: DetectedLanguage): { engine: TtsInstance; speakerId?: number } {
		if (language === "pl" && this.piperTts) {
			return { engine: this.piperTts };
		}
		if (this.kokoroTts) {
			return { engine: this.kokoroTts, speakerId: resolveVoiceId(this.config.enVoice) };
		}
		if (this.piperTts) {
			return { engine: this.piperTts };
		}
		throw new Error("No TTS engine initialized");
	}

	generate(text: string, language: DetectedLanguage): TtsResult {
		const { engine, speakerId } = this.getEngine(language);
		return {
			samples: engine.generate(text, this.config.speed, speakerId),
			sampleRate: engine.sampleRate,
		};
	}

	/**
	 * Generate audio for an array of text chunks, calling onChunk
	 * after each one so the caller can stream to a speaker.
	 * Returns when all chunks have been generated (playback may still
	 * be draining in the speaker buffer).
	 */
	generateChunked(
		chunks: string[],
		language: DetectedLanguage,
		onChunk: (samples: Float32Array) => void,
		shouldStop?: () => boolean,
	): { sampleRate: number } {
		const { engine, speakerId } = this.getEngine(language);
		for (const chunk of chunks) {
			if (shouldStop?.()) break;
			const samples = engine.generate(chunk, this.config.speed, speakerId);
			if (shouldStop?.()) break;
			onChunk(samples);
		}
		return { sampleRate: engine.sampleRate };
	}

	getSampleRate(language: DetectedLanguage): number {
		const { engine } = this.getEngine(language);
		return engine.sampleRate;
	}

	get engines(): { kokoro: boolean; piper: boolean } {
		return {
			kokoro: this.kokoroTts !== null,
			piper: this.piperTts !== null,
		};
	}

	free(): void {
		this.kokoroTts?.free();
		this.piperTts?.free();
		this.kokoroTts = null;
		this.piperTts = null;
	}
}
