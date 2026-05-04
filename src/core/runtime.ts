/**
 * Runtime-mode detection shared across the CLI and core modules.
 *
 * `bun build --compile` bundles every module under a virtual `/$bunfs/` path,
 * which is observable via `import.meta.url`.  Under `bun run` or plain node
 * the URL is a real `file://` path on disk.
 */

import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);

export const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

export function isCompiledBinary(): boolean {
	return __filename.includes("/$bunfs/") || __filename.startsWith("$bunfs:");
}
