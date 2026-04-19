/**
 * Cross-platform audio playback.
 *
 * Strategy:
 * 1. Try `speaker` npm package (direct PCM output via ALSA/CoreAudio)
 * 2. Fallback: write WAV to temp file, play with system command
 *    - macOS: afplay
 *    - Linux: ffplay -nodisp -autoexit (or paplay, or aplay)
 */

import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isMac } from "./config.js";

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

/** Encode Float32 PCM samples to a WAV buffer */
function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
	const numChannels = 1;
	const bitsPerSample = 16;
	const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
	const blockAlign = numChannels * (bitsPerSample / 8);
	const dataSize = samples.length * (bitsPerSample / 8);
	const headerSize = 44;

	const buffer = Buffer.alloc(headerSize + dataSize);

	// RIFF header
	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + dataSize, 4);
	buffer.write("WAVE", 8);

	// fmt chunk
	buffer.write("fmt ", 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20); // PCM
	buffer.writeUInt16LE(numChannels, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(byteRate, 28);
	buffer.writeUInt16LE(blockAlign, 32);
	buffer.writeUInt16LE(bitsPerSample, 34);

	// data chunk
	buffer.write("data", 36);
	buffer.writeUInt32LE(dataSize, 40);

	// Convert float32 to int16
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		const v = s < 0 ? s * 0x8000 : s * 0x7fff;
		buffer.writeInt16LE(Math.round(v), headerSize + i * 2);
	}

	return buffer;
}

export interface PlaybackHandle {
	/** Promise that resolves when playback is done */
	done: Promise<void>;
	/** Stop playback */
	stop(): void;
}

/**
 * Streaming audio player — writes PCM chunks as they arrive.
 * Uses the `speaker` npm package for direct output.
 */
export interface StreamingPlayer {
	/** Write a chunk of audio samples */
	write(samples: Float32Array): void;
	/** Signal that no more data will be written */
	end(): void;
	/** Promise that resolves when all audio has been played */
	done: Promise<void>;
	/** Stop playback immediately */
	stop(): void;
}

/** Create a streaming player using the `speaker` npm package */
export async function createStreamingPlayer(sampleRate: number): Promise<StreamingPlayer | null> {
	try {
		const Speaker = (await import("speaker")).default;

		const speaker = new Speaker({
			channels: 1,
			bitDepth: 16,
			sampleRate,
			signed: true,
		});

		let stopped = false;

		const done = new Promise<void>((resolve, reject) => {
			speaker.on("close", resolve);
			speaker.on("error", (err: Error) => {
				if (!stopped) reject(err);
				else resolve();
			});
		});

		return {
			write(samples: Float32Array) {
				if (!stopped) {
					speaker.write(float32ToInt16Buffer(samples));
				}
			},
			end() {
				if (!stopped) {
					speaker.end();
				}
			},
			done,
			stop() {
				if (!stopped) {
					stopped = true;
					try {
						speaker.close?.();
					} catch {
						// ignore
					}
				}
			},
		};
	} catch {
		return null;
	}
}

/** Find a working system audio player */
function findSystemPlayer(): { cmd: string; args: (file: string) => string[] } {
	if (isMac()) {
		return { cmd: "afplay", args: (f) => [f] };
	}

	// Linux — ffplay is the most reliable
	return { cmd: "ffplay", args: (f) => ["-nodisp", "-autoexit", "-loglevel", "quiet", f] };
}

/** Play audio using a system command (WAV file fallback) */
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
			} catch {
				// ignore cleanup errors
			}
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
			if (proc && !proc.killed) {
				proc.kill("SIGTERM");
			}
		},
	};
}

/**
 * Play pre-generated audio samples.
 * Tries native `speaker` first, falls back to system command.
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
