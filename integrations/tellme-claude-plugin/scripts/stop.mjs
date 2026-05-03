#!/usr/bin/env node
import { stopAll } from "./socket.mjs";

try {
	await stopAll();
	process.stdout.write("tellme: playback stopped\n");
} catch (err) {
	process.stdout.write(`tellme: nothing to stop (${err && err.code ? err.code : "no daemon"})\n`);
}
