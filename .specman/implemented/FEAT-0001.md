---
id: FEAT-0001
title: Background TTS daemon
status: draft
depends_on: []
---

## Intent

Today every `tellme` invocation loads ~430 MB of TTS models from scratch, runs once, and exits. That works for occasional CLI use but breaks down when an AI coding agent calls `tellme` repeatedly within a session: each call pays the model-load cost, and concurrent calls play over each other because no process coordinates audio output. A long-running per-user daemon keeps the models warm and serializes playback into a queue, so every plugin (Claude Code, OpenCode, future agents) gets fast, non-overlapping playback by continuing to shell out to `tellme "..."`.

This spec covers the daemon process itself, its local-only transport, and the synchronous one-shot request shape: the client sends a complete text payload, the daemon plays it to completion, the client returns. Incremental/streaming playback and automatic daemon lifecycle management are addressed in follow-up specs (FEAT-0002, FEAT-0003).

## Behavior

The daemon is local-only. It listens on a per-user Unix domain socket, never on a network port, and exists only to coordinate playback for the user that started it. The user starts it explicitly (`tellme daemon start`) and stops it explicitly; automatic lifecycle is not part of this spec.

A request is one connection. The client opens the socket, sends an optional header (per-call overrides for `lang`, `voice`, `speed`, `raw`), then sends the full `text` payload and signals end-of-input. The daemon plays the text to completion, signals completion back, and closes. The CLI blocks for the full round trip — its exit code reflects whether playback succeeded — so existing scripts and pipelines that depend on `tellme` blocking don't change.

When the daemon is not running, the CLI runs in-process exactly as it does today. There is no auto-spawn in this version; routing through the daemon happens only when the daemon is already up.

## Acceptance criteria

### Routing and isolation

- AC-1 — Given the daemon is running, when `tellme "..."` is invoked, the text is sent to the daemon over the local socket and the CLI returns without loading TTS models in its own process.
- AC-2 — The daemon listens on a per-user Unix domain socket under `~/.tellme/` and is not reachable over any network interface.
- AC-3 — A daemon and CLI of incompatible protocol versions refuse to talk and report a clear error to the user rather than misbehaving silently.

### Playback semantics

- AC-4 — Given the daemon is mid-playback, when another request arrives, the new text is queued and played after the current text finishes; audible overlap does not occur.
- AC-5 — TTS models stay loaded in the daemon between requests; subsequent requests do not pay the model-load cost.
- AC-6 — When the user requests stop, the daemon halts the current utterance and clears the queue.

### Request shape

- AC-7 — A request must carry `text`. The fields `lang`, `voice`, `speed`, and `raw` are optional; if present they override the daemon's configured defaults for that utterance only, and absent fields fall through to defaults sourced from `~/.tellme/config.json`. Subsequent requests are unaffected by another request's per-call overrides.
- AC-8 — Errors during synthesis or playback are surfaced back to the requesting client with a human-readable message before the connection closes.

### Connection completion

- AC-9 — The CLI invocation returns only after the daemon signals playback completion for that request. Its exit code reflects whether playback finished successfully.
- AC-10 — The daemon sends a completion signal to the client when playback of all submitted text has finished, before closing the connection.

### Operations

- AC-11 — The daemon can be explicitly started, stopped, and queried via CLI subcommands. The status query reports at least: running state, socket path, and current queue depth.

## Out of scope

- Incremental / streaming text delivery within a single request. This spec assumes one request = one complete text payload; the daemon may wait for end-of-input before starting playback. Streaming is addressed in FEAT-0002.
- Automatic daemon lifecycle (auto-spawn on first use, idle shutdown, opt-out). The user starts and stops the daemon explicitly here. Addressed in FEAT-0003.
- Per-request mid-utterance abort. The only way to interrupt playback in this version is the global stop (AC-6).
- Remote agents pushing playback to a different machine's audio output. This spec is local-only.
- Plugin or harness-specific behavior. Existing integrations (Claude Code, OpenCode) and any future ones remain shell wrappers over `tellme "..."` and are not changed by this spec.
- Backpressure or queue-size limits. The daemon may grow its queue without an explicit cap in this version.
