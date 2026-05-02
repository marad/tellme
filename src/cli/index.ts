#!/usr/bin/env node

/**
 * tellme CLI — read text aloud using local TTS models.
 *
 * Usage:
 *   tellme "Hello world"              # speak text
 *   echo "Hello" | tellme             # pipe text
 *   tellme --download                 # download models
 *   tellme --lang pl "Dzień dobry"    # force Polish
 *   tellme --voice af_bella "Hi"      # select Kokoro voice
 *   tellme --speed 1.2 "Fast speech"  # adjust speed
 *   tellme --list-voices              # list available voices
 */

import { KOKORO_VOICES, loadConfig, type TellMeConfig } from "../core/config.js";
import { ensureAllModels, isKokoroReady, isPiperPlReady, type DownloadProgress } from "../core/model-manager.js";
import { TellMeTts } from "../core/tts-engine.js";
import { playAudio, createStreamingPlayer } from "../core/audio-player.js";
import { detectLanguage } from "../core/language-detect.js";
import { prepareForSpeech, splitIntoChunks } from "../core/text-prep.js";
import { runDaemon } from "../core/daemon-server.js";
import { tryDaemonRoute } from "../core/daemon-client.js";
import { daemonStart, daemonStop, daemonStatus } from "./daemon-cmd.js";

function printUsage() {
	console.log(`
tellme — Local TTS for coding agents

Usage:
  tellme [options] [text]
  echo "text" | tellme [options]

Options:
  --download          Download TTS models (Kokoro EN + Piper PL)
  --lang <en|pl|auto> Force language (default: auto)
  --voice <name>      Kokoro EN voice (default: from config)
  --speed <0.5-2.0>   Speech speed (default: from config)
  --pl-voice <name>  Polish voice: meski_wg_glos-medium, justyna_wg_glos-medium
  --list-voices       List available Kokoro voices
  --status            Show model download status
  --raw               Skip text preparation (read as-is)
  -h, --help          Show this help
`);
}

function parseArgs(argv: string[]) {
	const defaults = loadConfig();
	const result = {
		text: null as string | null,
		download: false,
		language: defaults.language,
		voice: defaults.enVoice,
		speed: defaults.speed,
		plVoice: defaults.plVoice,
		listVoices: false,
		status: false,
		raw: false,
		help: false,
	};

	const positional: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case "--download": result.download = true; break;
			case "--lang": result.language = argv[++i] as "auto" | "en" | "pl"; break;
			case "--voice": result.voice = argv[++i]; break;
			case "--speed": result.speed = parseFloat(argv[++i]); break;
			case "--pl-voice": result.plVoice = argv[++i] as TellMeConfig["plVoice"]; break;
			case "--list-voices": result.listVoices = true; break;
			case "--status": result.status = true; break;
			case "--raw": result.raw = true; break;
			case "-h": case "--help": result.help = true; break;
			default:
				if (!arg.startsWith("-")) positional.push(arg);
				break;
		}
	}

	if (positional.length > 0) result.text = positional.join(" ");
	return result;
}

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf-8").trim();
}

async function main() {
	// Hidden subcommand used by `tellme daemon start` to fork the daemon.
	// MUST short-circuit before any normal CLI parsing or daemon routing —
	// otherwise the daemon process would itself try to talk to a daemon.
	if (process.argv[2] === "__daemon-main__") {
		if (process.argv.length > 3) {
			console.error("Error: __daemon-main__ takes no arguments");
			process.exit(1);
		}
		await runDaemon();
		return;
	}

	// Daemon control subcommands.
	if (process.argv[2] === "daemon") {
		const sub = process.argv[3];
		if (sub === "start") process.exit(await daemonStart());
		else if (sub === "stop") process.exit(await daemonStop());
		else if (sub === "status") process.exit(await daemonStatus());
		else {
			console.error("Usage: tellme daemon <start|stop|status>");
			process.exit(1);
		}
	}

	const args = parseArgs(process.argv.slice(2));

	if (args.help) { printUsage(); process.exit(0); }

	const config: TellMeConfig = {
		...loadConfig(),
		language: args.language,
		speed: args.speed,
		plVoice: args.plVoice as TellMeConfig["plVoice"],
		enVoice: args.voice,
	};

	if (args.listVoices) {
		console.log("Kokoro EN voices:");
		for (const [name, id] of Object.entries(KOKORO_VOICES)) {
			const marker = name === config.enVoice ? " ← current" : "";
			const prefix = name.startsWith("af") || name === "af" ? "🇺🇸F" :
			               name.startsWith("am") ? "🇺🇸M" :
			               name.startsWith("bf") ? "🇬🇧F" : "🇬🇧M";
			console.log(`  ${id.toString().padStart(2)} ${prefix} ${name}${marker}`);
		}
		process.exit(0);
	}

	if (args.status) {
		console.log(`Models directory: ${config.modelsDir}`);
		console.log(`Kokoro EN:  ${isKokoroReady(config) ? "✅ ready" : "❌ not downloaded"}`);
		console.log(`Piper PL:   ${isPiperPlReady(config) ? "✅ ready" : "❌ not downloaded"} (${config.plVoice})`);
		process.exit(0);
	}

	if (args.download) {
		console.log("Downloading TTS models...");
		await ensureAllModels(config, (p: DownloadProgress) => {
			if (p.phase === "downloading") {
				process.stdout.write(`\r  ${p.model}: downloading ${p.percent ?? 0}%     `);
			} else if (p.phase === "extracting") {
				process.stdout.write(`\r  ${p.model}: extracting...          \n`);
			} else if (p.phase === "done") {
				console.log(`  ${p.model}: ✅ done`);
			} else if (p.phase === "error") {
				console.error(`  ${p.model}: ❌ ${p.error}`);
			}
		});
		console.log("All models ready.");
		process.exit(0);
	}

	// Get text
	let text = args.text;
	if (!text && !process.stdin.isTTY) {
		text = await readStdin();
	}
	if (!text) { printUsage(); process.exit(1); }

	// If a daemon is running, route through it. The daemon handles text
	// preparation and synthesis itself; we return without ever loading models.
	{
		const code = await tryDaemonRoute(
			{
				text,
				language: config.language,
				voice: config.enVoice,
				speed: config.speed,
				raw: args.raw,
			},
		);
		if (code !== null) process.exit(code);
	}

	// Prepare text for speech
	if (!args.raw) {
		text = prepareForSpeech(text);
	}

	if (!text.trim()) {
		console.error("Nothing to speak after text preparation.");
		process.exit(1);
	}

	const language = config.language === "auto" ? detectLanguage(text) : config.language;

	const tts = new TellMeTts(config);
	await tts.init();

	const chunks = splitIntoChunks(text);
	if (chunks.length === 0) {
		console.error("Nothing to speak.");
		process.exit(1);
	}

	// Try streaming playback: generate chunk by chunk, pipe to speaker
	const sampleRate = tts.getSampleRate(language);
	const player = await createStreamingPlayer(sampleRate);

	let stopped = false;
	process.on("SIGINT", () => {
		stopped = true;
		player?.stop();
		process.exit(0);
	});

	if (player) {
		await tts.generateChunked(chunks, language,
			(samples) => player.write(samples),
			() => stopped,
		);
		player.end();
		await player.done;
	} else {
		// Fallback: generate all, play with system command
		const { samples, sampleRate: sr } = tts.generate(text, language);
		const handle = await playAudio(samples, sr);
		process.on("SIGINT", () => { handle.stop(); process.exit(0); });
		await handle.done;
	}

	tts.free();
}

main().catch((err) => {
	console.error("Error:", err.message);
	process.exit(1);
});
