export { TellMeTts, type TtsResult } from "./tts-engine.js";
export { playAudio, createStreamingPlayer, trimSilence, type PlaybackHandle, type StreamingPlayer } from "./audio-player.js";
export { detectLanguage, type DetectedLanguage } from "./language-detect.js";
export { prepareForSpeech, splitIntoChunks, stripMarkdown } from "./text-prep.js";
export { ensureAllModels, ensureKokoro, ensurePiperPl, isKokoroReady, isPiperPlReady } from "./model-manager.js";
export { DEFAULT_CONFIG, KOKORO_VOICES, resolveVoiceId, type TellMeConfig } from "./config.js";
