#!/usr/bin/env node

// CLI launcher — uses jiti to run TypeScript directly
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
	// Use jiti for TypeScript execution (same as Pi uses)
	try {
		const { createJiti } = await import("jiti");
		const jiti = createJiti(import.meta.url);
		await jiti.import(join(__dirname, "..", "src", "cli", "index.ts"));
	} catch {
		// Fallback: try tsx or ts-node
		const { execFileSync } = await import("node:child_process");
		const tsFile = join(__dirname, "..", "src", "cli", "index.ts");
		try {
			execFileSync("npx", ["tsx", tsFile, ...process.argv.slice(2)], { stdio: "inherit" });
		} catch {
			console.error("Error: Cannot run TypeScript. Install jiti or tsx: npm install -g tsx");
			process.exit(1);
		}
	}
}

main();
