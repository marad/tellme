/**
 * Tell Me — Pi extension that reads assistant messages aloud.
 *
 * Playback is ALWAYS non-blocking: commands and shortcuts start speech
 * in the background and return immediately. Use /tellme-stop or Escape
 * to cancel.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { DEFAULT_CONFIG, KOKORO_VOICES, resolveVoiceId, type TellMeConfig } from "../../core/config.js";
import { TellMeTts } from "../../core/tts-engine.js";
import { playAudio, type PlaybackHandle } from "../../core/audio-player.js";
import { detectLanguage, type DetectedLanguage } from "../../core/language-detect.js";
import { prepareForSpeech } from "../../core/text-prep.js";
import { ensureAllModels, isKokoroReady, isPiperPlReady } from "../../core/model-manager.js";

export default function tellMeExtension(pi: ExtensionAPI) {
	let config: TellMeConfig = { ...DEFAULT_CONFIG };
	let tts: TellMeTts | null = null;
	let currentPlayback: PlaybackHandle | null = null;
	let autoRead = config.autoRead;
	let lastAssistantText: string | null = null;
	let initPromise: Promise<void> | null = null;
	let speaking = false;

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
	}

	/**
	 * Start speaking text in the background. Does NOT block.
	 * Returns immediately after launching playback.
	 */
	function speakInBackground(
		text: string,
		notify?: (msg: string, type: string) => void,
	) {
		// Stop any current playback first
		stopPlayback();

		// Launch async work without awaiting
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

				speaking = true;
				const { samples, sampleRate } = engine.generate(cleanText, language);

				// Could have been stopped during generation
				if (!speaking) return;

				currentPlayback = await playAudio(samples, sampleRate);
				await currentPlayback.done;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				notify?.(`TTS error: ${msg}`, "error");
			} finally {
				currentPlayback = null;
				speaking = false;
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

	// --- Events ---

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
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!autoRead) return;
		if (!lastAssistantText) return;
		if (lastAssistantText.trim().length < 20) return;

		speakInBackground(lastAssistantText, (msg, type) => ctx.ui.notify(msg, type));
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

		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === "tellme-config") {
				const data = entry.data as any;
				if (typeof data.autoRead === "boolean") autoRead = data.autoRead;
				if (typeof data.enVoice === "string") config.enVoice = data.enVoice;
				if (typeof data.speed === "number") config.speed = data.speed;
				if (data.plModel) config.plModel = data.plModel;
			}
		}

		if (isKokoroReady(config) || isPiperPlReady(config)) {
			const engines = [];
			if (isKokoroReady(config)) engines.push("EN");
			if (isPiperPlReady(config)) engines.push("PL");
			ctx.ui.setStatus("tellme", `🔊 ${engines.join("+")}${autoRead ? " [auto]" : ""}`);
		}
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
			pi.appendEntry("tellme-config", { autoRead, enVoice: config.enVoice, speed: config.speed });

			const engines = [];
			if (isKokoroReady(config)) engines.push("EN");
			if (isPiperPlReady(config)) engines.push("PL");
			ctx.ui.setStatus("tellme", `🔊 ${engines.join("+")}${autoRead ? " [auto]" : ""}`);
			ctx.ui.notify(`Auto-read: ${autoRead ? "ON ✅" : "OFF ❌"}`, "info");
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
				pi.appendEntry("tellme-config", { autoRead, enVoice: config.enVoice, speed: config.speed });
				ctx.ui.notify(`Voice: ${choice}`, "success");
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

				const engines = [];
				if (isKokoroReady(config)) engines.push("EN");
				if (isPiperPlReady(config)) engines.push("PL");
				ctx.ui.setStatus("tellme", `🔊 ${engines.join("+")}${autoRead ? " [auto]" : ""}`);
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
