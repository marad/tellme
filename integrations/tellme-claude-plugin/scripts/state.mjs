import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const FILE_NAME = "tellme.json";

export function stateFile(projectDir) {
	return join(projectDir, ".claude", FILE_NAME);
}

export function readState(projectDir) {
	const path = stateFile(projectDir);
	if (!existsSync(path)) return { autoRead: false };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return { autoRead: !!parsed.autoRead };
	} catch {
		return { autoRead: false };
	}
}

export function writeState(projectDir, state) {
	const path = stateFile(projectDir);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ autoRead: !!state.autoRead }, null, 2) + "\n", "utf8");
}
