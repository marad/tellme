#!/usr/bin/env bun
/**
 * A/B parity check: render the same text through both the N-API and FFI
 * paths and compare results.  Run with:
 *
 *   bun experiments/bun-ffi-spike/parity-check.ts
 *
 * Reuses tts-engine.ts.  Resets the module cache between runs so the
 * `useFfi` constant is re-evaluated against the toggled env.
 */

import { writeFileSync } from "node:fs";
import { loadConfig } from "../../src/core/config.ts";

const TEXT = "Hello from sherpa onnx. We are validating that the F F I path matches the N A P I path.";

async function render(label: string, useFfi: boolean) {
	process.env.TELLME_FFI = useFfi ? "1" : "0";
	// Bust the module cache so tts-engine.ts re-reads the env flag.
	const { createKokoroTts } = await import(`../../src/core/tts-engine.ts?cache=${Math.random()}`);
	const cfg = loadConfig();
	const t0 = performance.now();
	const tts = await createKokoroTts(cfg);
	const t1 = performance.now();
	const samples = tts.generate(TEXT);
	const t2 = performance.now();
	tts.free();

	const path = `/tmp/parity-${label}.wav`;
	writeWav(path, samples, tts.sampleRate);

	console.log(
		`[${label}]  init=${(t1 - t0).toFixed(0)}ms  gen=${(t2 - t1).toFixed(0)}ms  ` +
			`n=${samples.length}  sr=${tts.sampleRate}  -> ${path}`,
	);
	return { samples, sr: tts.sampleRate };
}

function writeWav(path: string, s: Float32Array, sr: number) {
	const dataSize = s.length * 2;
	const buf = Buffer.alloc(44 + dataSize);
	buf.write("RIFF", 0);
	buf.writeUInt32LE(36 + dataSize, 4);
	buf.write("WAVE", 8);
	buf.write("fmt ", 12);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(1, 22);
	buf.writeUInt32LE(sr, 24);
	buf.writeUInt32LE(sr * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write("data", 36);
	buf.writeUInt32LE(dataSize, 40);
	for (let i = 0; i < s.length; i++) {
		const v = Math.max(-1, Math.min(1, s[i]));
		buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
	}
	writeFileSync(path, buf);
}

function compare(a: Float32Array, b: Float32Array): { maxAbsDiff: number; rms: number } {
	const n = Math.min(a.length, b.length);
	let maxAbsDiff = 0;
	let sumSq = 0;
	for (let i = 0; i < n; i++) {
		const d = Math.abs(a[i] - b[i]);
		if (d > maxAbsDiff) maxAbsDiff = d;
		sumSq += d * d;
	}
	return { maxAbsDiff, rms: Math.sqrt(sumSq / n) };
}

const napi = await render("napi", false);
const ffi = await render("ffi", true);

console.log("");
console.log(`sample rates match: ${napi.sr === ffi.sr}`);
console.log(`length napi=${napi.samples.length} ffi=${ffi.samples.length}  diff=${ffi.samples.length - napi.samples.length}`);

if (napi.samples.length === ffi.samples.length) {
	const { maxAbsDiff, rms } = compare(napi.samples, ffi.samples);
	console.log(`max abs sample diff: ${maxAbsDiff.toExponential(3)}`);
	console.log(`RMS diff:            ${rms.toExponential(3)}`);
}
