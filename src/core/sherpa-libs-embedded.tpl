/**
 * Embedded sherpa-onnx shared libraries for `bun build --compile`.
 *
 * THIS IS A TEMPLATE — `make vendor-libs PLATFORM=<plat>` materializes
 * src/core/sherpa-libs-embedded.generated.ts from this file by substituting
 * __PLATFORM__ and __LIBEXT__.  The generated file is gitignored; it must
 * exist at compile time but not at dev / test time (bun run falls back to
 * createRequire-based lookup when the import fails).
 *
 * Static `with { type: "file" }` imports cause Bun to embed the file into the
 * compiled binary; at runtime the import returns a /$bunfs/... virtual path.
 * Under `bun run` (no compile), the same imports return the real on-disk path.
 */

import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// @ts-expect-error binary asset import — bun-only syntax
import LIB_C_API_PATH from "../../vendor/sherpa-libs/__PLATFORM__/libsherpa-onnx-c-api.__LIBEXT__" with { type: "file" };
// @ts-expect-error binary asset import
import LIB_ONNX_PATH from "../../vendor/sherpa-libs/__PLATFORM__/libonnxruntime.__LIBEXT__" with { type: "file" };
// @ts-expect-error binary asset import
import LIB_CXX_PATH from "../../vendor/sherpa-libs/__PLATFORM__/libsherpa-onnx-cxx-api.__LIBEXT__" with { type: "file" };

interface EmbeddedFile {
	name: string;
	embeddedPath: string;
}

const EMBEDDED: EmbeddedFile[] = [
	{ name: "libsherpa-onnx-c-api.__LIBEXT__", embeddedPath: LIB_C_API_PATH },
	{ name: "libonnxruntime.__LIBEXT__", embeddedPath: LIB_ONNX_PATH },
	{ name: "libsherpa-onnx-cxx-api.__LIBEXT__", embeddedPath: LIB_CXX_PATH },
];

const VERSION_TAG = "__VERSION_TAG__";

/**
 * Resolve a directory containing real on-disk copies of the sherpa libs.
 *
 * In compiled mode the embedded paths point at /$bunfs/, which dlopen cannot
 * load — so we extract them once into ~/.cache/tellme/sherpa-libs/<ver>/ and
 * point dlopen there.  In non-compiled mode the imports already resolve to
 * vendor/ on disk, so dlopen could use them directly; we still mirror them
 * into the cache to keep one code path.
 */
export async function extractEmbeddedLibs(): Promise<string> {
	const cacheDir = join(homedir(), ".cache", "tellme", "sherpa-libs", VERSION_TAG);

	if (EMBEDDED.every((f) => existsSync(join(cacheDir, f.name)))) {
		return cacheDir;
	}

	mkdirSync(cacheDir, { recursive: true });

	for (const f of EMBEDDED) {
		const dst = join(cacheDir, f.name);
		if (existsSync(dst)) continue;
		// Write to a sibling tmp file then rename — rename is atomic on the same
		// filesystem, so a concurrent first-run from a second process can't
		// observe a partial file.
		const tmp = `${dst}.${process.pid}.tmp`;
		const bytes = await readEmbedded(f.embeddedPath);
		writeFileSync(tmp, bytes);
		chmodSync(tmp, 0o755);
		renameSync(tmp, dst);
	}

	return cacheDir;
}

async function readEmbedded(p: string): Promise<Buffer> {
	// Bun.file works for both /$bunfs/ paths (compiled) and real paths (dev).
	const bun = (globalThis as { Bun?: { file(p: string): { arrayBuffer(): Promise<ArrayBuffer> } } }).Bun;
	if (!bun) throw new Error("sherpa-libs-embedded: requires bun runtime");
	const ab = await bun.file(p).arrayBuffer();
	return Buffer.from(ab);
}
