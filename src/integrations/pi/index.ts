/**
 * Tell Me — Pi extension that reads assistant messages aloud.
 *
 * Playback is ALWAYS non-blocking: commands and shortcuts start speech
 * in the background and return immediately. Use /tellme-stop or Escape
 * to cancel.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { DEFAULT_CONFIG, KOKORO_VOICES, PIPER_PL_MODELS, resolveVoiceId, type TellMeConfig } from "../../core/config.js";
import { TellMeTts } from "../../core/tts-engine.js";
import { playAudio, createStreamingPlayer, trimSilence, type PlaybackHandle, type StreamingPlayer } from "../../core/audio-player.js";
import { detectLanguage, type DetectedLanguage } from "../../core/language-detect.js";
import { prepareForSpeech, splitIntoChunks } from "../../core/text-prep.js";
import { ensureAllModels, isKokoroReady, isPiperPlReady } from "../../core/model-manager.js";

export default function tellMeExtension(pi: ExtensionAPI) {
	let config: TellMeConfig = { ...DEFAULT_CONFIG };
	let tts: TellMeTts | null = null;
	let currentPlayback: PlaybackHandle | null = null;
	let autoRead = config.autoRead;
	let lastAssistantText: string | null = null;
	let initPromise: Promise<void> | null = null;
	let speaking = false;
	let statusUpdater: ((status: string) => void) | null = null;

	// --- Live streaming TTS state ---
	let liveStreamActive = false;
	let liveBuffer = "";
	let liveSentenceQueue: string[] = [];
	let livePlayer: StreamingPlayer | null = null;
	let liveLanguage: DetectedLanguage | null = null;
	let liveGenPromise: Promise<void> | null = null;
	let liveSentenceCount = 0;

	function idleStatus() {
		const kokoro = isKokoroReady(config);
		const piper = isPiperPlReady(config);
		if (!kokoro && !piper) return "";
		const autoTag = autoRead ? " [auto]" : "";
		const speedTag = config.speed !== 1.0 ? ` ${config.speed}x` : "";
		if (config.language === "en") return `🔊 EN${speedTag}${autoTag}`;
		if (config.language === "pl") return `🔊 PL${speedTag}${autoTag}`;
		const engines = [];
		if (kokoro) engines.push("EN");
		if (piper) engines.push("PL");
		return `🔊 ${engines.join("+")}${speedTag}${autoTag}`;
	}

	// --- Lazy TTS initialization ---

	async function ensureTts(): Promise<TellMeTts> {
		if (tts) return tts;

		if (!initPromise) {
			initPromise = (async () => {
				const modelsReady = isKokoroReady(config) || isPiperPlReady(config);
				if (!modelsReady) {
					throw new Error("No TTS models found. Run /tellme-download first.");
				}
				tts = new TellMeTts(config);
				await tts.init();
			})();
		}

		await initPromise;
		return tts!;
	}

	// --- Playback helpers ---

	function stopPlayback() {
		if (currentPlayback) {
			currentPlayback.stop();
			currentPlayback = null;
		}
		speaking = false;
		stopLiveStream();
		statusUpdater?.(idleStatus());
	}

	/**
	 * Start speaking text in the background using chunked streaming.
	 * Splits text into sentences, generates audio chunk by chunk,
	 * and pipes each chunk to speaker immediately — so the first
	 * sentence starts playing while later ones are still generating.
	 */
	function speakInBackground(
		text: string,
		notify?: (msg: string, type: string) => void,
	) {
		stopPlayback();
		speaking = true;
		statusUpdater?.(`🔊 ⏳ loading...`);

		(async () => {
			try {
				const engine = await ensureTts();
				const cleanText = prepareForSpeech(text);

				if (!cleanText.trim()) {
					notify?.("Nothing to speak — message is empty.", "info");
					return;
				}

				const language: DetectedLanguage =
					config.language === "auto" ? detectLanguage(cleanText) : config.language;
				const langLabel = language === "pl" ? "PL" : "EN";

				const chunks = splitIntoChunks(cleanText);
				if (chunks.length === 0) return;

				statusUpdater?.(`🔊 ⏳ generating ${langLabel}...`);

				const sampleRate = engine.getSampleRate(language);
				const player = await createStreamingPlayer(sampleRate);

				if (player) {
					const total = chunks.length;
					let current = 0;
					statusUpdater?.(`🔊 ▶ streaming ${langLabel} [1/${total}]`);

					currentPlayback = { done: player.done, stop: () => player.stop() };

					await engine.generateChunked(chunks, language,
						(samples) => {
							current++;
							statusUpdater?.(`🔊 ▶ streaming ${langLabel} [${current}/${total}]`);
							player.write(samples);
						},
						() => !speaking,
					);

					statusUpdater?.(`🔊 ▶ playing ${langLabel}`);
					player.end();
					await player.done;
				} else {
					statusUpdater?.(`🔊 ▶ generating ${langLabel} (fallback)...`);
					const { samples, sampleRate: sr } = engine.generate(cleanText, language);
					if (!speaking) return;
					statusUpdater?.(`🔊 ▶ playing ${langLabel} (fallback)`);
					currentPlayback = await playAudio(samples, sr);
					await currentPlayback.done;
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				notify?.(`TTS error: ${msg}`, "error");
			} finally {
				currentPlayback = null;
				speaking = false;
				statusUpdater?.(idleStatus());
			}
		})();
	}
	// --- Extract last assistant text from session ---

	function getLastAssistantText(ctx: { sessionManager: { getBranch: () => any[] } }): string | null {
		const entries = ctx.sessionManager.getBranch();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "message" && entry.message?.role === "assistant") {
				const content = entry.message.content;
				if (typeof content === "string") return content;
				if (Array.isArray(content)) {
					const textParts = content
						.filter((p: any) => p.type === "text")
						.map((p: any) => p.text);
					if (textParts.length > 0) return textParts.join("\n");
				}
			}
		}
		return null;
	}

	// --- Live streaming TTS: generate audio while agent is still typing ---

	/** Extract complete sentences from buffer, leave remainder */
	function extractSentences(buf: string): { sentences: string[]; remainder: string } {
		const sentences: string[] = [];
		// Match up to a sentence-ending punctuation followed by space or end
		const re = /^([\s\S]*?[.!?;:\n])(?=\s|$)/;
		let rest = buf;
		while (true) {
			const m = rest.match(re);
			if (!m) break;
			const raw = m[1].trim();
			if (raw) sentences.push(raw);
			rest = rest.slice(m[0].length);
		}
		return { sentences, remainder: rest };
	}

	/** Start the background generation loop that drains liveSentenceQueue */
	function startLiveGenLoop() {
		if (liveGenPromise) return; // already running
		liveGenPromise = (async () => {
			try {
				const engine = await ensureTts();
				while (liveStreamActive || liveSentenceQueue.length > 0) {
					if (liveSentenceQueue.length === 0) {
						// Wait a bit for more sentences
						await new Promise(r => setTimeout(r, 50));
						continue;
					}
					if (!speaking) break;

					// Detect language: wait for ~200 chars of text for reliable detection
					if (!liveLanguage) {
						const allQueued = liveSentenceQueue.join(" ");
						if (allQueued.length < 200 && liveStreamActive) {
							// Not enough text yet — keep waiting
							await new Promise(r => setTimeout(r, 100));
							continue;
						}
						liveLanguage = config.language === "auto"
							? detectLanguage(allQueued)
							: config.language;
					}

					const sentence = liveSentenceQueue.shift()!;
					const cleaned = prepareForSpeech(sentence);
					if (!cleaned.trim()) continue;

					// Create player on first chunk
					if (!livePlayer) {
						const sr = engine.getSampleRate(liveLanguage);
						livePlayer = await createStreamingPlayer(sr) ?? null;
						if (!livePlayer) break;
						currentPlayback = { done: livePlayer.done, stop: () => livePlayer!.stop() };
					}

					const chunks = splitIntoChunks(cleaned);
					for (const chunk of chunks) {
						if (!speaking) break;
						await new Promise(r => setImmediate(r));
						let samples = engine.generate(chunk, liveLanguage).samples;
						samples = trimSilence(samples, liveSentenceCount > 0, true);
						livePlayer.write(samples);
						liveSentenceCount++;
						const langLabel = liveLanguage === "pl" ? "PL" : "EN";
						statusUpdater?.(`🔊 ▶ live ${langLabel} [${liveSentenceCount}]`);
					}
				}
			} catch (_err) {
				// silently stop on error
			} finally {
				if (livePlayer) {
					livePlayer.end();
					const langLabel = liveLanguage === "pl" ? "PL" : "EN";
					statusUpdater?.(`🔊 ▶ playing ${langLabel}`);
					await livePlayer.done;
				}
				livePlayer = null;
				currentPlayback = null;
				speaking = false;
				liveGenPromise = null;
				statusUpdater?.(idleStatus());
			}
		})();
	}

	function stopLiveStream() {
		liveStreamActive = false;
		liveBuffer = "";
		liveSentenceQueue = [];
		liveLanguage = null;
		liveSentenceCount = 0;
	}

	// --- Events ---

	pi.on("message_start", async (event) => {
		if (event.message?.role === "assistant" && autoRead) {
			// Stop any ongoing playback and start live stream
			stopPlayback();
			stopLiveStream();
			liveStreamActive = true;
			speaking = true;
			statusUpdater?.(`🔊 ⏳ listening...`);
		}
	});

	pi.on("message_update", async (event) => {
		if (!liveStreamActive) return;
		if (!speaking) return;
		const delta = (event as any).assistantMessageEvent;
		if (!delta || delta.type !== "text_delta") return;

		liveBuffer += delta.delta;

		// Extract complete sentences
		const { sentences, remainder } = extractSentences(liveBuffer);
		liveBuffer = remainder;

		if (sentences.length > 0) {
			liveSentenceQueue.push(...sentences);
			startLiveGenLoop();
		}
	});

	pi.on("message_end", async (event) => {
		if (event.message?.role === "assistant") {
			const content = event.message.content;
			if (typeof content === "string") {
				lastAssistantText = content;
			} else if (Array.isArray(content)) {
				const textParts = content
					.filter((p: any) => p.type === "text")
					.map((p: any) => p.text);
				if (textParts.length > 0) {
					lastAssistantText = textParts.join("\n");
				}
			}

			// Flush remaining buffer for live stream
			if (liveStreamActive && liveBuffer.trim()) {
				liveSentenceQueue.push(liveBuffer.trim());
				liveBuffer = "";
				startLiveGenLoop();
			}
			liveStreamActive = false;
		}
	});

	pi.on("agent_end", async (_event, _ctx) => {
		// If live stream was active, it already handled TTS — nothing to do.
		// If autoRead is off or live stream wasn't started, also nothing.
	});

	pi.on("session_shutdown", async () => {
		stopPlayback();
		tts?.free();
		tts = null;
		initPromise = null;
	});

	pi.on("session_start", async (_event, ctx) => {
		lastAssistantText = null;
		stopPlayback();

		statusUpdater = (s: string) => ctx.ui.setStatus("tellme", s);

		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "tellme-config") {
				const data = entry.data as any;
				if (typeof data.autoRead === "boolean") autoRead = data.autoRead;
				if (typeof data.enVoice === "string") config.enVoice = data.enVoice;
				if (typeof data.speed === "number") config.speed = data.speed;
				if (data.plModel) config.plModel = data.plModel;
				if (data.language === "auto" || data.language === "en" || data.language === "pl") config.language = data.language;
			}
		}

		statusUpdater(idleStatus());
	});

	// --- Commands (all non-blocking) ---

	pi.registerCommand("tellme", {
		description: "Read the last assistant message aloud (non-blocking)",
		handler: async (_args, ctx) => {
			const text = lastAssistantText || getLastAssistantText(ctx);
			if (!text) {
				ctx.ui.notify("No assistant message to read.", "info");
				return;
			}
			speakInBackground(text, (msg, type) => ctx.ui.notify(msg, type));
			// Returns immediately — playback runs in background
		},
	});

	pi.registerCommand("tellme-stop", {
		description: "Stop current TTS playback",
		handler: async (_args, ctx) => {
			if (speaking) {
				stopPlayback();
				ctx.ui.notify("Playback stopped.", "info");
			} else {
				ctx.ui.notify("Nothing is playing.", "info");
			}
		},
	});

	pi.registerCommand("tellme-auto", {
		description: "Toggle auto-read of assistant messages",
		handler: async (_args, ctx) => {
			autoRead = !autoRead;
			pi.appendEntry("tellme-config", { autoRead, language: config.language, enVoice: config.enVoice, plModel: config.plModel, speed: config.speed });
			statusUpdater?.(idleStatus());
			ctx.ui.notify(`Auto-read: ${autoRead ? "ON ✅" : "OFF ❌"}`, "info");
		},
	});

	pi.registerCommand("tellme-lang", {
		description: "Set language: auto, en, or pl",
		handler: async (_args, ctx) => {
			const options = [
				"auto — detect automatically",
				"en — English only",
				"pl — Polish only",
			];
			const choice = await ctx.ui.select(
				`Current: ${config.language}. Pick language:`,
				options,
			);
			if (choice) {
				const lang = choice.split(" ")[0] as "auto" | "en" | "pl";
				config.language = lang;
				pi.appendEntry("tellme-config", { autoRead, language: config.language, enVoice: config.enVoice, plModel: config.plModel, speed: config.speed });
				statusUpdater?.(idleStatus());
				ctx.ui.notify(`Language: ${lang}`, "success");
			}
		},
	});

	pi.registerCommand("tellme-speed", {
		description: "Set speech speed (0.5x - 2.0x)",
		handler: async (_args, ctx) => {
			const options = ["0.5x", "0.75x", "1.0x", "1.25x", "1.5x", "1.75x", "2.0x"];
			const choice = await ctx.ui.select(
				`Current speed: ${config.speed}x. Pick:`,
				options,
			);
			if (choice) {
				config.speed = parseFloat(choice);
				pi.appendEntry("tellme-config", { autoRead, language: config.language, enVoice: config.enVoice, plModel: config.plModel, speed: config.speed });
				statusUpdater?.(idleStatus());
				ctx.ui.notify(`Speed: ${config.speed}x`, "success");
			}
		},
	});

	pi.registerCommand("tellme-voice", {
		description: "Select Kokoro EN voice",
		handler: async (_args, ctx) => {
			const voiceNames = Object.keys(KOKORO_VOICES);

			const choice = await ctx.ui.select(
				`Current: ${config.enVoice}. Pick a voice:`,
				voiceNames,
			);

			if (choice && choice in KOKORO_VOICES) {
				config.enVoice = choice;
				tts?.free();
				tts = null;
				initPromise = null;
				pi.appendEntry("tellme-config", { autoRead, language: config.language, enVoice: config.enVoice, plModel: config.plModel, speed: config.speed });
				ctx.ui.notify(`Voice: ${choice}`, "success");
			}
		},
	});

	pi.registerCommand("tellme-plvoice", {
		description: "Select Polish voice",
		handler: async (_args, ctx) => {
			const models = Object.entries(PIPER_PL_MODELS);
			const labels = models.map(([key, m]) => `${m.label} (${key})`);

			const choice = await ctx.ui.select(
				`Current PL voice: ${config.plModel}. Pick:`,
				labels,
			);

			if (choice) {
				const idx = labels.indexOf(choice);
				if (idx >= 0) {
					const [key] = models[idx];
					config.plModel = key as TellMeConfig["plModel"];
					tts?.free();
					tts = null;
					initPromise = null;
					pi.appendEntry("tellme-config", { autoRead, language: config.language, enVoice: config.enVoice, plModel: config.plModel, speed: config.speed });
					ctx.ui.notify(`PL voice: ${PIPER_PL_MODELS[key].label}`, "success");
				}
			}
		},
	});

	pi.registerCommand("tellme-download", {
		description: "Download TTS models (Kokoro EN + Piper PL)",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Downloading TTS models...", "info");

			try {
				await ensureAllModels(config, (p) => {
					if (p.phase === "downloading") {
						ctx.ui.setStatus("tellme", `📥 ${p.model}: ${p.percent ?? 0}%`);
					} else if (p.phase === "extracting") {
						ctx.ui.setStatus("tellme", `📦 ${p.model}: extracting...`);
					} else if (p.phase === "done") {
						ctx.ui.setStatus("tellme", `✅ ${p.model}`);
					} else if (p.phase === "error") {
						ctx.ui.setStatus("tellme", `❌ ${p.error}`);
					}
				});

				tts?.free();
				tts = null;
				initPromise = null;

				statusUpdater?.(idleStatus());
				ctx.ui.notify("TTS models ready! ✅", "success");
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.setStatus("tellme", "");
				ctx.ui.notify(`Download failed: ${msg}`, "error");
			}
		},
	});

	pi.registerCommand("tellme-status", {
		description: "Show Tell Me TTS status",
		handler: async (_args, ctx) => {
			const kokoro = isKokoroReady(config);
			const piper = isPiperPlReady(config);

			const lines = [
				`🔊 Tell Me`,
				`Kokoro EN: ${kokoro ? "✅" : "❌"} | Piper PL: ${piper ? "✅" : "❌"} (${config.plModel})`,
				`Voice: ${config.enVoice} | Speed: ${config.speed}x | Auto: ${autoRead ? "ON" : "OFF"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// --- Shortcuts ---

	pi.registerShortcut("ctrl+shift+s", {
		description: "Speak / stop last assistant message",
		handler: async (ctx) => {
			// Toggle: if speaking → stop, otherwise → speak
			if (speaking) {
				stopPlayback();
				return;
			}

			const text = lastAssistantText || getLastAssistantText(ctx);
			if (!text) {
				ctx.ui.notify("No assistant message to read.", "info");
				return;
			}
			speakInBackground(text, (msg, type) => ctx.ui.notify(msg, type));
		},
	});

	// --- Custom tool ---

	pi.registerTool({
		name: "speak",
		label: "Speak",
		description: "Read text aloud using local TTS. Use when the user asks you to read something or say something out loud.",
		promptSnippet: "Read text aloud using local TTS (Kokoro EN / Piper PL)",
		parameters: Type.Object({
			text: Type.String({ description: "Text to speak aloud" }),
			language: Type.Optional(
				Type.Union([Type.Literal("en"), Type.Literal("pl"), Type.Literal("auto")], {
					description: "Language: en, pl, or auto (default: auto-detect)",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const text = prepareForSpeech(params.text);
			const lang = params.language || "auto";
			const detectedLang = lang === "auto" ? detectLanguage(text) : lang;

			try {
				const engine = await ensureTts();
				const { samples, sampleRate } = engine.generate(text, detectedLang as DetectedLanguage);
				currentPlayback = await playAudio(samples, sampleRate);
				speaking = true;
				await currentPlayback.done;
				speaking = false;
				currentPlayback = null;

				return {
					content: [{ type: "text", text: `Spoke text aloud (${detectedLang}).` }],
					details: { language: detectedLang, length: text.length },
				};
			} catch (err) {
				speaking = false;
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `TTS error: ${msg}` }],
					details: { error: msg },
				};
			}
		},
	});
}
