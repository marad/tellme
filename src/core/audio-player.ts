/**
 * Cross-platform audio playback.
 *
 * Streaming strategy (for chunked TTS):
 *   Pipe raw PCM to a subprocess (paplay/aplay/ffplay/sox).
 *   Separate process = separate CPU scheduling, so TTS generation
 *   on the main thread doesn't starve audio output.
 *
 * One-shot fallback:
 *   Write WAV to temp file, play with afplay/ffplay.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, setPriority } from "node:os";
import { isMac } from "./config.js";

/**
 * Generate a silent audio buffer of a given duration.
 * Used to insert controlled pauses between speech chunks.
 */
export function generateSilence(sampleRate: number, durationMs: number): Float32Array {
	const numSamples = Math.round(sampleRate * durationMs / 1000);
	return new Float32Array(numSamples); // all zeros = silence
}

/** Convert float32 samples to int16 buffer */
function float32ToInt16Buffer(samples: Float32Array): Buffer {
	const buffer = Buffer.alloc(samples.length * 2);
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		const v = s < 0 ? s * 0x8000 : s * 0x7fff;
		buffer.writeInt16LE(Math.round(v), i * 2);
	}
	return buffer;
}

/**
 * Trim silence from the start and/or end of an audio chunk.
 * Used between streaming chunks to avoid audible gaps.
 */
export function trimSilence(
	samples: Float32Array,
	trimStart: boolean,
	trimEnd: boolean,
	threshold = 0.01,
	keepSamples = 200,
): Float32Array {
	let start = 0;
	let end = samples.length;

	if (trimStart) {
		while (start < end && Math.abs(samples[start]) < threshold) start++;
		start = Math.max(0, start - keepSamples);
	}

	if (trimEnd) {
		while (end > start && Math.abs(samples[end - 1]) < threshold) end--;
		end = Math.min(samples.length, end + keepSamples);
	}

	if (start === 0 && end === samples.length) return samples;
	return samples.subarray(start, end);
}

/** Encode Float32 PCM samples to a WAV buffer */
function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
	const numChannels = 1;
	const bitsPerSample = 16;
	const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
	const blockAlign = numChannels * (bitsPerSample / 8);
	const dataSize = samples.length * (bitsPerSample / 8);
	const headerSize = 44;

	const buffer = Buffer.alloc(headerSize + dataSize);

	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + dataSize, 4);
	buffer.write("WAVE", 8);
	buffer.write("fmt ", 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(numChannels, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(byteRate, 28);
	buffer.writeUInt16LE(blockAlign, 32);
	buffer.writeUInt16LE(bitsPerSample, 34);
	buffer.write("data", 36);
	buffer.writeUInt32LE(dataSize, 40);

	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		const v = s < 0 ? s * 0x8000 : s * 0x7fff;
		buffer.writeInt16LE(Math.round(v), headerSize + i * 2);
	}

	return buffer;
}

export interface PlaybackHandle {
	done: Promise<void>;
	stop(): void;
}

export interface StreamingPlayer {
	write(samples: Float32Array): void;
	end(): void;
	done: Promise<void>;
	stop(): void;
}

// ── Detect available commands (cached) ──

let _cmdCache: Map<string, boolean> | null = null;

function hasCommand(name: string): boolean {
	if (!_cmdCache) _cmdCache = new Map();
	if (_cmdCache.has(name)) return _cmdCache.get(name)!;
	const result = spawnSync("which", [name], { stdio: "ignore" }).status === 0;
	_cmdCache.set(name, result);
	return result;
}

// ── Subprocess streaming player ──

interface StreamingCmd {
	cmd: string;
	args: string[];
}

/**
 * Find a command that accepts raw PCM on stdin.
 * Preference: paplay > aplay > ffplay > sox play
 */
function findStreamingCmd(sampleRate: number): StreamingCmd | null {
	if (!isMac() && hasCommand("paplay")) {
		return {
			cmd: "paplay",
			args: [
				"--raw",
				"--format=s16le",
				"--channels=1",
				`--rate=${sampleRate}`,
			],
		};
	}

	if (!isMac() && hasCommand("aplay")) {
		return {
			cmd: "aplay",
			args: ["-f", "S16_LE", "-c", "1", "-r", String(sampleRate), "-t", "raw", "-q"],
		};
	}

	if (hasCommand("ffplay")) {
		return {
			cmd: "ffplay",
			args: [
				"-nodisp", "-autoexit", "-loglevel", "quiet",
				"-f", "s16le", "-ar", String(sampleRate), "-ac", "1",
				"-i", "pipe:0",
			],
		};
	}

	if (hasCommand("play")) {
		// sox play
		return {
			cmd: "play",
			args: ["-t", "raw", "-r", String(sampleRate), "-b", "16", "-c", "1", "-e", "signed-integer", "-"],
		};
	}

	return null;
}

/**
 * Create a streaming player using a subprocess.
 * The audio player runs in a separate process so TTS generation
 * on the main thread doesn't starve audio output.
 */
export async function createStreamingPlayer(sampleRate: number): Promise<StreamingPlayer | null> {
	const cmd = findStreamingCmd(sampleRate);
	if (!cmd) return null;

	const proc = spawn(cmd.cmd, cmd.args, {
		stdio: ["pipe", "ignore", "ignore"],
	});

	// Try to boost audio process priority (may fail without CAP_SYS_NICE)
	if (proc.pid) {
		try { setPriority(proc.pid, -5); } catch { /* needs privileges */ }
	}

	let stopped = false;

	const done = new Promise<void>((resolve, reject) => {
		proc.on("close", () => resolve());
		proc.on("error", (err) => {
			if (!stopped) reject(err);
			else resolve();
		});
		proc.stdin!.on("error", () => {
			// Broken pipe — process exited early, ignore
		});
	});

	return {
		write(samples: Float32Array) {
			if (!stopped && proc.stdin && !proc.stdin.destroyed) {
				proc.stdin.write(float32ToInt16Buffer(samples));
			}
		},
		end() {
			if (!stopped && proc.stdin && !proc.stdin.destroyed) {
				proc.stdin.end();
			}
		},
		done,
		stop() {
			if (!stopped) {
				stopped = true;
				try {
					proc.stdin?.destroy();
					proc.kill("SIGTERM");
				} catch { /* ignore */ }
			}
		},
	};
}

// ── One-shot WAV playback (fallback) ──

function findSystemPlayer(): { cmd: string; args: (file: string) => string[] } {
	if (isMac()) {
		return { cmd: "afplay", args: (f) => [f] };
	}
	return { cmd: "ffplay", args: (f) => ["-nodisp", "-autoexit", "-loglevel", "quiet", f] };
}

async function playWithSystemCommand(samples: Float32Array, sampleRate: number): Promise<PlaybackHandle> {
	const player = findSystemPlayer();

	const tmpDir = await mkdtemp(join(tmpdir(), "tellme-"));
	const wavFile = join(tmpDir, "speech.wav");

	const wavBuffer = encodeWav(samples, sampleRate);
	await writeFile(wavFile, wavBuffer);

	let proc: ChildProcess | null = null;

	const done = new Promise<void>((resolve, reject) => {
		proc = spawn(player.cmd, player.args(wavFile), { stdio: "ignore" });
		proc.on("close", async () => {
			try {
				await unlink(wavFile);
				await unlink(tmpDir).catch(() => {});
			} catch { /* ignore */ }
			resolve();
		});
		proc.on("error", async (err) => {
			try { await unlink(wavFile); } catch { /* ignore */ }
			reject(err);
		});
	});

	return {
		done,
		stop() {
			if (proc && !proc.killed) proc.kill("SIGTERM");
		},
	};
}

/**
 * Play pre-generated audio samples.
 * Tries streaming player first, falls back to WAV file.
 */
export async function playAudio(samples: Float32Array, sampleRate: number): Promise<PlaybackHandle> {
	const streaming = await createStreamingPlayer(sampleRate);
	if (streaming) {
		streaming.write(samples);
		streaming.end();
		return { done: streaming.done, stop: () => streaming.stop() };
	}

	return playWithSystemCommand(samples, sampleRate);
}
