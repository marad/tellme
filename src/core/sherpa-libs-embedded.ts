/**
 * Embedded sherpa-onnx shared libraries for `bun build --compile`.
 *
 * Static `with { type: "file" }` imports cause Bun to embed the file into the
 * compiled binary; at runtime the import returns a /$bunfs/... virtual path.
 * Under `bun run` (no compile), the same imports return the real on-disk path.
 *
 * The vendored libraries must be present at build time.  Build script:
 *
 *   make vendor-libs   # copies node_modules/sherpa-onnx-<plat>/*.so into vendor/
 *   make compile       # bun build --compile ... src/cli/index.ts
 *
 * Currently linux-x64 only — extending to darwin/arm64/windows requires
 * platform-specific embed modules selected at build time.
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// @ts-expect-error binary asset import — bun-only syntax
import LIB_C_API_PATH from "../../vendor/sherpa-libs/linux-x64/libsherpa-onnx-c-api.so" with { type: "file" };
// @ts-expect-error binary asset import
import LIB_ONNX_PATH from "../../vendor/sherpa-libs/linux-x64/libonnxruntime.so" with { type: "file" };
// @ts-expect-error binary asset import
import LIB_CXX_PATH from "../../vendor/sherpa-libs/linux-x64/libsherpa-onnx-cxx-api.so" with { type: "file" };

interface EmbeddedFile {
	name: string;
	embeddedPath: string;
}

const EMBEDDED: EmbeddedFile[] = [
	{ name: "libsherpa-onnx-c-api.so", embeddedPath: LIB_C_API_PATH },
	{ name: "libonnxruntime.so", embeddedPath: LIB_ONNX_PATH },
	{ name: "libsherpa-onnx-cxx-api.so", embeddedPath: LIB_CXX_PATH },
];

const VERSION_TAG = "1.12.38-linux-x64";

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
		const bytes = await readEmbedded(f.embeddedPath);
		writeFileSync(dst, bytes);
		chmodSync(dst, 0o755);
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
