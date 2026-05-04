/**
 * TTS Engine — unified interface over Kokoro (EN) and Piper (PL).
 * Uses sherpa-onnx-node for both backends.
 */

import { resolveVoiceId, type TellMeConfig } from "./config.js";
import { getKokoroPaths, getPiperPlPaths } from "./model-manager.js";
import { trimSilence, generateSilence } from "./audio-player.js";
import type { DetectedLanguage } from "./language-detect.js";
import type { SpeechChunk } from "./text-prep.js";
import { isBun, isCompiledBinary } from "./runtime.js";

// sherpa-onnx-node loaded dynamically to handle optional dep
let sherpa: any = null;

async function getSherpa() {
	if (!sherpa) {
		const mod = await import("sherpa-onnx-node");
		sherpa = mod.default ?? mod;
	}
	return sherpa;
}

// FFI is the only viable path in compiled binaries (sherpa-onnx-node is
// `--external`'d, so the N-API addon isn't present).  In dev / `bun run` the
// N-API addon is the default and TELLME_FFI=1 opts in to FFI for testing.
const useFfi = isBun && (isCompiledBinary() || process.env.TELLME_FFI === "1");

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
	if (useFfi) {
		const { createKokoroTtsFFI } = await import("./sherpa-ffi.js");
		return createKokoroTtsFFI(config);
	}

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
			numThreads: 4,
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
	if (useFfi) {
		const { createPiperTtsFFI } = await import("./sherpa-ffi.js");
		return createPiperTtsFFI(config);
	}

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
			numThreads: 4,
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

		// Surface init failures to stderr (daemon log captures them).  Without
		// this, a fully-failed init throws "No TTS models available" with no
		// hint about which engine broke or why.
		if (kokoro.status === "rejected") {
			console.error("[tts-engine] kokoro init failed:", kokoro.reason);
		}
		if (piper.status === "rejected") {
			console.error("[tts-engine] piper init failed:", piper.reason);
		}

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
	 * Generate audio for an array of speech chunks, calling onChunk
	 * after each one so the caller can stream to a speaker.
	 * Inserts silence between chunks based on pauseBefore hints.
	 * Async — yields to event loop between chunks so UI updates
	 * render and speaker buffers can drain.
	 */
	async generateChunked(
		chunks: SpeechChunk[],
		language: DetectedLanguage,
		onChunk: (samples: Float32Array) => void,
		shouldStop?: () => boolean,
	): Promise<{ sampleRate: number }> {
		const { engine, speakerId } = this.getEngine(language);
		for (let i = 0; i < chunks.length; i++) {
			if (shouldStop?.()) break;
			// Insert explicit pause before this chunk
			if (chunks[i].pauseBefore > 0) {
				onChunk(generateSilence(engine.sampleRate, chunks[i].pauseBefore));
			}
			// Yield to event loop so UI renders and speaker drains
			await new Promise(resolve => setImmediate(resolve));
			let samples = engine.generate(chunks[i].text, this.config.speed, speakerId);
			if (shouldStop?.()) break;
			// Trim silence at chunk boundaries to avoid audible gaps:
			// - First chunk: keep leading silence, trim trailing
			// - Last chunk: trim leading silence, keep trailing
			// - Middle chunks: trim both sides
			const isFirst = i === 0;
			const isLast = i === chunks.length - 1;
			samples = trimSilence(samples, !isFirst, !isLast);
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
