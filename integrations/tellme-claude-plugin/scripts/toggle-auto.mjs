#!/usr/bin/env node
import { readState, writeState, stateFile } from "./state.mjs";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const state = readState(projectDir);
state.autoRead = !state.autoRead;
writeState(projectDir, state);

const status = state.autoRead ? "ON" : "OFF";
process.stdout.write(`tellme auto-read: ${status}\n  project: ${projectDir}\n  state:   ${stateFile(projectDir)}\n`);
