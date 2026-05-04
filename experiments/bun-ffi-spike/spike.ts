#!/usr/bin/env bun
/**
 * bun:ffi spike — drive sherpa-onnx OfflineTts (Kokoro) directly via the C API.
 * Validates struct layout + dlopen path so we know option 1 is viable before
 * touching src/core/tts-engine.ts.
 *
 * Run: bun experiments/bun-ffi-spike/spike.ts
 * Out: /tmp/spike.wav
 */

// @ts-expect-error bun:ffi types unresolved at edit time; runs fine under bun
import { dlopen, FFIType, ptr, read, suffix, toArrayBuffer } from "bun:ffi";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SHERPA_DIR = "/home/marad/dev/tellme/node_modules/sherpa-onnx-linux-x64";
const KOKORO = join(homedir(), ".tellme/models/kokoro-en-v0_19");
const OUT_WAV = "/tmp/spike.wav";

const lib = dlopen(join(SHERPA_DIR, `libsherpa-onnx-c-api.${suffix}`), {
	SherpaOnnxCreateOfflineTts: { args: [FFIType.ptr], returns: FFIType.ptr },
	SherpaOnnxDestroyOfflineTts: { args: [FFIType.ptr], returns: FFIType.void },
	SherpaOnnxOfflineTtsSampleRate: { args: [FFIType.ptr], returns: FFIType.i32 },
	SherpaOnnxOfflineTtsNumSpeakers: { args: [FFIType.ptr], returns: FFIType.i32 },
	SherpaOnnxOfflineTtsGenerate: {
		args: [FFIType.ptr, FFIType.cstring, FFIType.i32, FFIType.f32],
		returns: FFIType.ptr,
	},
	SherpaOnnxDestroyOfflineTtsGeneratedAudio: { args: [FFIType.ptr], returns: FFIType.void },
});

// ---- struct layout (linux-x64, ptrs=8B, int32/float=4B, structs aligned to 8) ----
//
// SherpaOnnxOfflineTtsVitsModelConfig          size=56  align=8
//   model        ptr  @0
//   lexicon      ptr  @8
//   tokens       ptr  @16
//   data_dir     ptr  @24
//   noise_scale  f32  @32
//   noise_w      f32  @36
//   length_scale f32  @40
//   (pad 4)
//   dict_dir     ptr  @48
//
// SherpaOnnxOfflineTtsMatchaModelConfig        size=56
//   acoustic_model @0  vocoder @8  lexicon @16  tokens @24  data_dir @32
//   noise_scale f32 @40  length_scale f32 @44  dict_dir ptr @48
//
// SherpaOnnxOfflineTtsKokoroModelConfig        size=64
//   model    @0   voices   @8   tokens   @16   data_dir @24
//   length_scale f32 @32   (pad 4)
//   dict_dir @40  lexicon @48  lang @56
//
// SherpaOnnxOfflineTtsKittenModelConfig        size=40
//   model @0 voices @8 tokens @16 data_dir @24 length_scale f32 @32 (pad 4)
//
// SherpaOnnxOfflineTtsZipvoiceModelConfig      size=64
//   tokens @0 encoder @8 decoder @16 vocoder @24 data_dir @32 lexicon @40
//   feat_scale f32 @48  t_shift f32 @52  target_rms f32 @56  guidance_scale f32 @60
//
// SherpaOnnxOfflineTtsPocketModelConfig        size=64
//   lm_flow @0 lm_main @8 encoder @16 decoder @24 text_conditioner @32
//   vocab_json @40 token_scores_json @48 voice_embedding_cache_capacity i32 @56 (pad 4)
//
// SherpaOnnxOfflineTtsSupertonicModelConfig    size=56
//   duration_predictor @0 text_encoder @8 vector_estimator @16 vocoder @24
//   tts_json @32 unicode_indexer @40 voice_style @48
//
// SherpaOnnxOfflineTtsModelConfig              size=416
//   vits        @0   (56)
//   num_threads i32 @56
//   debug       i32 @60
//   provider    ptr @64
//   matcha      @72  (56)
//   kokoro      @128 (64)
//   kitten      @192 (40)
//   zipvoice    @232 (64)
//   pocket      @296 (64)
//   supertonic  @360 (56)  -> ends @416
//
// SherpaOnnxOfflineTtsConfig                   size=448
//   model              @0   (416)
//   rule_fsts          ptr @416
//   max_num_sentences  i32 @424   (pad 4)
//   rule_fars          ptr @432
//   silence_scale      f32 @440   (pad 4)
//
// SherpaOnnxGeneratedAudio                     size=16
//   samples ptr @0   n i32 @8   sample_rate i32 @12

const CONFIG_SIZE = 448;
const KOKORO_OFFSET = 128;

// keep cstrings alive for the lifetime of the call
const pinned: Buffer[] = [];
function cstr(s: string): bigint {
	const b = Buffer.from(s + "\0", "utf-8");
	pinned.push(b);
	return BigInt(ptr(b));
}

const cfg = Buffer.alloc(CONFIG_SIZE);
const wp = (off: number, p: bigint) => cfg.writeBigUInt64LE(p, off);
const wi = (off: number, v: number) => cfg.writeInt32LE(v, off);
const wf = (off: number, v: number) => cfg.writeFloatLE(v, off);

// model.kokoro
wp(KOKORO_OFFSET + 0, cstr(`${KOKORO}/model.onnx`));
wp(KOKORO_OFFSET + 8, cstr(`${KOKORO}/voices.bin`));
wp(KOKORO_OFFSET + 16, cstr(`${KOKORO}/tokens.txt`));
wp(KOKORO_OFFSET + 24, cstr(`${KOKORO}/espeak-ng-data`));
wf(KOKORO_OFFSET + 32, 1.0); // length_scale

// model.num_threads / debug / provider
wi(56, 4);
wi(60, 0);
wp(64, cstr("cpu"));

// top-level
wi(424, 1); // max_num_sentences
wf(440, 0.2); // silence_scale

console.log("creating tts...");
const tts = lib.symbols.SherpaOnnxCreateOfflineTts(ptr(cfg));
if (!tts) throw new Error("SherpaOnnxCreateOfflineTts returned null");

const sampleRate = lib.symbols.SherpaOnnxOfflineTtsSampleRate(tts);
const numSpeakers = lib.symbols.SherpaOnnxOfflineTtsNumSpeakers(tts);
console.log(`sampleRate=${sampleRate} numSpeakers=${numSpeakers}`);

const text =
	"Hello from sherpa onnx, called directly via Bun's foreign function interface. The spike works.";
const t0 = performance.now();
const audio = lib.symbols.SherpaOnnxOfflineTtsGenerate(tts, Buffer.from(text + "\0", "utf-8"), 0, 1.0);
const t1 = performance.now();
if (!audio) throw new Error("SherpaOnnxOfflineTtsGenerate returned null");

const samplesPtr = read.ptr(audio, 0);
const n = read.i32(audio, 8);
const sr = read.i32(audio, 12);
console.log(`generated n=${n} samples sr=${sr} in ${(t1 - t0).toFixed(0)}ms`);

const samples = new Float32Array(toArrayBuffer(samplesPtr, 0, n * 4));
writeWav(OUT_WAV, samples, sr);
console.log(`wrote ${OUT_WAV} (${(samples.length / sr).toFixed(2)}s)`);

lib.symbols.SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio);
lib.symbols.SherpaOnnxDestroyOfflineTts(tts);

function writeWav(path: string, s: Float32Array, sr: number): void {
	const blockAlign = 2;
	const dataSize = s.length * 2;
	const buf = Buffer.alloc(44 + dataSize);
	buf.write("RIFF", 0);
	buf.writeUInt32LE(36 + dataSize, 4);
	buf.write("WAVE", 8);
	buf.write("fmt ", 12);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20); // PCM
	buf.writeUInt16LE(1, 22); // mono
	buf.writeUInt32LE(sr, 24);
	buf.writeUInt32LE(sr * blockAlign, 28);
	buf.writeUInt16LE(blockAlign, 32);
	buf.writeUInt16LE(16, 34);
	buf.write("data", 36);
	buf.writeUInt32LE(dataSize, 40);
	for (let i = 0; i < s.length; i++) {
		const v = Math.max(-1, Math.min(1, s[i]));
		buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
	}
	writeFileSync(path, buf);
}
