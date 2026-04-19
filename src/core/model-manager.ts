/**
 * Model manager — download, extract, and cache TTS models.
 */

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline as streamPipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { KOKORO_MODEL, PIPER_PL_MODELS, type TellMeConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export interface ModelPaths {
	kokoro: {
		model: string;
		voices: string;
		tokens: string;
		dataDir: string;
	} | null;
	piper: {
		model: string;
		tokens: string;
		dataDir: string;
	} | null;
}

/** Check if Kokoro EN model is downloaded */
export function isKokoroReady(config: TellMeConfig): boolean {
	const dir = join(config.modelsDir, KOKORO_MODEL.name);
	return existsSync(join(dir, KOKORO_MODEL.files.model));
}

/** Check if Piper PL model is downloaded */
export function isPiperPlReady(config: TellMeConfig): boolean {
	const variant = config.plVoice;
	const modelInfo = PIPER_PL_MODELS[variant];
	if (!modelInfo) return false;
	const dirName = `vits-piper-pl_PL-${variant}`;
	const dir = join(config.modelsDir, dirName);
	return existsSync(join(dir, modelInfo.onnxFile));
}

/** Get paths to Kokoro model files */
export function getKokoroPaths(config: TellMeConfig): ModelPaths["kokoro"] {
	if (!isKokoroReady(config)) return null;
	const dir = join(config.modelsDir, KOKORO_MODEL.name);
	return {
		model: join(dir, KOKORO_MODEL.files.model),
		voices: join(dir, KOKORO_MODEL.files.voices),
		tokens: join(dir, KOKORO_MODEL.files.tokens),
		dataDir: join(dir, KOKORO_MODEL.files.dataDir),
	};
}

/** Get paths to Piper PL model files */
export function getPiperPlPaths(config: TellMeConfig): ModelPaths["piper"] {
	if (!isPiperPlReady(config)) return null;
	const variant = config.plVoice;
	const modelInfo = PIPER_PL_MODELS[variant];
	if (!modelInfo) return null;
	const dirName = `vits-piper-pl_PL-${variant}`;
	const dir = join(config.modelsDir, dirName);
	return {
		model: join(dir, modelInfo.onnxFile),
		tokens: join(dir, "tokens.txt"),
		dataDir: join(dir, "espeak-ng-data"),
	};
}

export interface DownloadProgress {
	model: string;
	phase: "downloading" | "extracting" | "done" | "error";
	percent?: number;
	error?: string;
}

type ProgressCallback = (progress: DownloadProgress) => void;

async function downloadAndExtract(
	url: string,
	destDir: string,
	modelName: string,
	onProgress?: ProgressCallback,
): Promise<void> {
	await mkdir(destDir, { recursive: true });

	const tmpFile = join(destDir, "_download.tar.bz2");
	const tmpExtractDir = join(destDir, "_extracting");

	try {
		// Download
		onProgress?.({ model: modelName, phase: "downloading", percent: 0 });

		const response = await fetch(url, { redirect: "follow" });
		if (!response.ok || !response.body) {
			throw new Error(`Download failed: ${response.status} ${response.statusText}`);
		}

		const totalSize = Number(response.headers.get("content-length") || 0);
		let downloaded = 0;

		const fileStream = createWriteStream(tmpFile);
		const reader = response.body.getReader();

		// eslint-disable-next-line no-constant-condition
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			fileStream.write(Buffer.from(value));
			downloaded += value.byteLength;
			if (totalSize > 0) {
				onProgress?.({
					model: modelName,
					phase: "downloading",
					percent: Math.round((downloaded / totalSize) * 100),
				});
			}
		}
		fileStream.end();
		await new Promise<void>((resolve, reject) => {
			fileStream.on("finish", resolve);
			fileStream.on("error", reject);
		});

		// Extract
		onProgress?.({ model: modelName, phase: "extracting" });
		await mkdir(tmpExtractDir, { recursive: true });
		await execFileAsync("tar", ["xf", tmpFile, "-C", tmpExtractDir]);

		// Move extracted contents — tar usually creates a subdirectory
		const { stdout } = await execFileAsync("ls", [tmpExtractDir]);
		const entries = stdout.trim().split("\n").filter(Boolean);

		if (entries.length === 1) {
			// Single subdirectory — move its contents to destDir
			const subDir = join(tmpExtractDir, entries[0]);
			const { stdout: innerEntries } = await execFileAsync("ls", ["-A", subDir]);
			for (const entry of innerEntries.trim().split("\n").filter(Boolean)) {
				const src = join(subDir, entry);
				const dest = join(destDir, entry);
				if (existsSync(dest)) await rm(dest, { recursive: true });
				await rename(src, dest);
			}
		} else {
			// Multiple files at top level — move them all
			for (const entry of entries) {
				const src = join(tmpExtractDir, entry);
				const dest = join(destDir, entry);
				if (existsSync(dest)) await rm(dest, { recursive: true });
				await rename(src, dest);
			}
		}

		onProgress?.({ model: modelName, phase: "done" });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		onProgress?.({ model: modelName, phase: "error", error: msg });
		throw err;
	} finally {
		// Cleanup temp files
		if (existsSync(tmpFile)) await rm(tmpFile, { force: true });
		if (existsSync(tmpExtractDir)) await rm(tmpExtractDir, { recursive: true, force: true });
	}
}

/** Download Kokoro EN model if not already present */
export async function ensureKokoro(config: TellMeConfig, onProgress?: ProgressCallback): Promise<void> {
	if (isKokoroReady(config)) return;
	const dir = join(config.modelsDir, KOKORO_MODEL.name);
	await downloadAndExtract(KOKORO_MODEL.url, dir, "Kokoro EN (fp32, ~305 MB)", onProgress);
}

/** Download Piper PL model if not already present */
export async function ensurePiperPl(config: TellMeConfig, onProgress?: ProgressCallback): Promise<void> {
	if (isPiperPlReady(config)) return;
	const variant = config.plVoice;
	const modelInfo = PIPER_PL_MODELS[variant];
	if (!modelInfo) throw new Error(`Unknown Polish model variant: ${variant}`);
	const dirName = `vits-piper-pl_PL-${variant}`;
	const dir = join(config.modelsDir, dirName);
	await downloadAndExtract(modelInfo.url, dir, `Piper PL (${variant})`, onProgress);
}

/** Ensure both models are ready */
export async function ensureAllModels(config: TellMeConfig, onProgress?: ProgressCallback): Promise<void> {
	await Promise.all([ensureKokoro(config, onProgress), ensurePiperPl(config, onProgress)]);
}
