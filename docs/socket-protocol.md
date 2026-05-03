# TellMe Daemon Socket Protocol

> **Version:** 1  
> **Transport:** Unix domain socket  
> **Audience:** Plugin and integration developers (Cloud Code, Claude Code, OpenCode, custom editors, etc.)

---

## 1. Overview

The TellMe daemon is a long-running background process that keeps TTS models warm and serializes audio playback into a single queue. All communication between a client and the daemon happens over a **per-user Unix domain socket** using a simple length-prefixed JSON protocol.

This document describes the wire protocol so you can write custom clients — for example, a Cloud Code plugin that streams AI responses directly to the daemon without shelling out to the `tellme` CLI.

### Key properties

| Property | Value |
|----------|-------|
| Transport | Unix domain socket (local only, no TCP) |
| Framing | 4-byte big-endian length prefix + UTF-8 JSON |
| Max frame size | 16 MiB |
| Protocol version | `1` (sent in every request) |
| Queue discipline | FIFO — one utterance at a time, no overlap |
| Idle shutdown | Daemon exits after 10 min of inactivity (auto-spawned on next request) |

---

## 2. Socket Location

The socket file path is resolved in this order:

1. If `TELLME_DAEMON_DIR` is set → `${TELLME_DAEMON_DIR}/daemon.sock`
2. Otherwise → `${HOME}/.tellme/daemon.sock`

The PID file lives alongside it: `daemon.pid`.

### Permissions

- The containing directory is created with `0o700` (user-only).
- The socket file is set to `0o600` after the server starts listening.

### Detecting a stale socket

If the socket file exists but no process is listening, connecting yields `ECONNREFUSED` (or `ENOENT` if it disappears between the existence check and the connect). The official daemon's startup probe unlinks a stale socket on either error before binding. The official client (`tryDaemonRoute` / `tryDaemonStreaming`) unlinks on `ECONNREFUSED` and falls back to its non-daemon path on `ENOENT`. Your client should do the same, or fall back to spawning the daemon.

---

## 3. Wire Format

### Framing

Every message on the socket is:

```
+----------------+------------------------+
| 4 bytes (BE)   | N bytes (UTF-8 JSON)   |
| frame length   | JSON payload           |
+----------------+------------------------+
```

- **Length:** unsigned 32-bit integer, big-endian
- **Payload:** a single JSON object, no trailing delimiter
- **Max length:** `16_777_216` bytes (16 MiB)

### Example: framing a message

```typescript
function encode(msg: object): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(msg));
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, json.length, false); // big-endian
  const frame = new Uint8Array(4 + json.length);
  frame.set(header, 0);
  frame.set(json, 4);
  return frame;
}
```

### Example: decoding messages from a stream

```typescript
async function* decodeMessages(readable: ReadableStream<Uint8Array>) {
  const reader = readable.getReader();
  let buf = new Uint8Array(0);
  const append = (chunk: Uint8Array) => {
    const next = new Uint8Array(buf.length + chunk.length);
    next.set(buf, 0);
    next.set(chunk, buf.length);
    buf = next;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    append(value);
    while (buf.length >= 4) {
      const len = new DataView(buf.buffer).getUint32(0, false);
      if (len > 16 * 1024 * 1024) throw new Error("frame too large");
      if (buf.length < 4 + len) break;
      const json = new TextDecoder().decode(buf.slice(4, 4 + len));
      buf = buf.slice(4 + len);
      yield JSON.parse(json);
    }
  }
}
```

---

## 4. Connection Model

- **One request = one connection.** The daemon does not multiplex multiple independent requests over a single socket.
- The daemon writes the final reply and then **closes** the connection.
- For **streaming**, the connection stays open for the lifetime of the request so the client can send follow-up `chunk` and `end` frames.

---

## 5. Request Modes

### 5.1 One-shot

Send the full text in a single `speak` frame. The daemon queues it, plays it to completion, and replies.

```
CLIENT                                          DAEMON
  │                                               │
  ├─ speak { text: "Hello world", ... } ─────────>│
  │                                               │
  │<──────────────────────────── ack { kind } ────┤
  │                                               │ (queued, then played)
  │<──────────────────────────── done { ok } ─────┤
  │<───────────────────────────────── [EOF] ──────┤
```

### 5.2 Streaming

Send `speak` with `streaming: true`. The daemon replies with `ack`, then the client continues sending `chunk` frames as text becomes available, and finally an `end` frame. The initial `speak` frame may also include non-empty `text` — it is seeded into the stream just like a `chunk`. Playback starts as soon as the first complete sentence is buffered.

```
CLIENT                                          DAEMON
  │                                               │
  ├─ speak { streaming: true, text: "", ... } ──>│
  │<──────────────────────────── ack { kind } ────┤
  ├─ chunk { text: "First sentence. " } ─────────>│
  ├─ chunk { text: "Second sentence." } ─────────>│
  ├─ end { kind } ───────────────────────────────>│
  │                                               │ (queued, then played)
  │<──────────────────────── done { ok } ─────────┤
  │<──────────────────────────────── [EOF] ───────┤
```

**Streaming timeouts:**
- **Idle timeout:** If no `chunk` arrives for 30 seconds, the daemon treats the stream as ended and flushes buffered text.
- **Max duration:** If the connection lives longer than 5 minutes, the daemon stops accepting new chunks, signals end-of-input to flush any buffered residue, and closes.

---

## 6. Message Reference

### 6.1 Client → Server

Every **first** message on a connection **must** include `version: 1`. The daemon rejects mismatched versions with a `version-mismatch` reply.

#### `speak`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | `"speak"` | ✅ | Message discriminator |
| `version` | `number` | ✅ | Must be `1` |
| `text` | `string` | ✅ | Text to speak (may be `""` in streaming mode) |
| `lang` | `"auto" \| "en" \| "pl"` | ❌ | Override language for this request |
| `voice` | `string` | ❌ | Override voice for this request |
| `speed` | `number` | ❌ | Override speed (e.g. `1.0`, `1.2`) |
| `raw` | `boolean` | ❌ | Skip text preparation (e.g. markdown stripping) |
| `streaming` | `boolean` | ❌ | Enable streaming mode (default: `false`) |

**Rules:**
- If `lang` is absent, the daemon falls back to its config default.
- If `lang` is `"auto"`, the daemon detects the language from the first sentence.
- In streaming mode, all sentences in the connection use the **same** language, fixed at first detection.
- Per-request overrides do **not** persist.
- If `text` is empty (or becomes empty after text preparation), the daemon replies with `done` immediately and no audio is synthesized.

#### `chunk` (streaming only)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | `"chunk"` | ✅ | Message discriminator |
| `text` | `string` | ✅ | Text fragment to append |

Sent on the **same connection** as the opening `speak` with `streaming: true`. Every `chunk` frame resets the streaming idle timer; empty `text` is dropped (no content pushed) but still counts as activity.

#### `end` (streaming only)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | `"end"` | ✅ | Message discriminator |

Signals end-of-input. The daemon flushes any remaining buffered text, then completes. If the client disconnects without sending `end`, the daemon treats it as a graceful end anyway.

#### `stop`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | `"stop"` | ✅ | Message discriminator |
| `version` | `number` | ✅ | Must be `1` |

**Global stop** — halts the currently playing utterance and clears the entire queue. This is not per-request. The daemon replies with `stopped` and closes. Pending requests also receive `stopped`.

#### `status`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | `"status"` | ✅ | Message discriminator |
| `version` | `number` | ✅ | Must be `1` |

Queries daemon state. The daemon replies with a `status` message and immediately closes.

---

### 6.2 Server → Client

#### `ack`

The request was accepted and queued.

```json
{ "kind": "ack" }
```

#### `done`

Playback finished successfully.

```json
{ "kind": "done", "ok": true }
```

#### `error`

Something went wrong.

```json
{ "kind": "error", "message": "human-readable description" }
```

#### `stopped`

The utterance was interrupted by a global `stop`.

```json
{ "kind": "stopped" }
```

#### `status`

Daemon state reply.

```json
{
  "kind": "status",
  "running": true,
  "socketPath": "/home/user/.tellme/daemon.sock",
  "queueDepth": 0,
  "version": 1
}
```

#### `version-mismatch`

The client's `version` does not match the daemon's. The daemon closes immediately after sending this.

```json
{
  "kind": "version-mismatch",
  "expected": 1,
  "got": 0
}
```

---

## 7. Versioning

- The current protocol version is `1`.
- Every request must include `version: 1`.
- If the daemon receives a request with a mismatched version, it replies with `version-mismatch` and closes.
- Hardcode `1` in your client. Future versions will bump this number.

---

## 8. Error Handling

| Scenario | Daemon behavior | Client should |
|----------|-----------------|---------------|
| Invalid JSON | Closes connection | Expect EOF, treat as error |
| Frame too large (>16 MiB) | Closes connection | Keep frames small |
| Version mismatch | `version-mismatch` reply, then close | Restart daemon or upgrade client |
| Unknown `kind` | Closes connection silently | — |
| `speak` on a connection that already has an active stream | `error` reply, then close | Open a new connection per request |
| `chunk` without an active stream | Silently ignored | — |
| `end` without an active stream | Closes the connection, no reply | — |
| Synthesis or playback failure | `error` reply, then close | Surface `message` to user |
| `ECONNREFUSED` on socket file | No daemon listening | Auto-spawn or inform user |
| `ENOENT` on socket file | Daemon never started | Auto-spawn or inform user |

---

## 9. Daemon Lifecycle

### Auto-spawn

If the socket file does not exist, the official CLI spawns the daemon by invoking the current Node binary (`process.execPath`) with the resolved `tellme` bin path:

```bash
"$NODE" /path/to/tellme/bin/tellme.js __daemon-main__
```

It is spawned **detached** with `stdio: "ignore"` and `unref()`'d so the parent CLI can exit while the daemon keeps running.

The low-level socket client (`tryDaemonRoute` / `tryDaemonStreaming`) does **not** auto-spawn — it returns `null` when the socket is missing, leaving spawning to the caller. Your custom client should either spawn the daemon itself before connecting, or shell out to the CLI and let it handle spawning.

### Idle shutdown

The daemon exits automatically after `TELLME_DAEMON_IDLE_MS` of inactivity (default: 600,000 ms = 10 minutes). The next client request triggers auto-spawn again.

### Environment variables

| Variable | Effect | Default |
|----------|--------|---------|
| `TELLME_DAEMON_DIR` | Overrides `~/.tellme` for socket and PID files | `~/.tellme` |
| `TELLME_DAEMON_IDLE_MS` | Idle timeout before daemon exits | `600000` |
| `TELLME_STREAM_IDLE_MS` | Streaming idle timeout | `30000` |
| `TELLME_STREAM_MAX_MS` | Streaming max duration cap | `300000` |

These values are read **once at daemon startup**. Changing them while the daemon is running has no effect until the daemon is restarted.

---

## 10. Quick Reference for Plugin Authors

### Speak a complete block of text

1. Connect to the Unix socket.
2. Send `speak` with the full `text`.
3. Read replies until `done`, `error`, or `stopped`.
4. The daemon closes the connection.

### Stream text as it generates

1. Connect to the Unix socket.
2. Send `speak` with `streaming: true` and `text: ""`.
3. Read `ack`.
4. As text arrives, send `chunk` frames.
5. When finished, send `end`.
6. Read replies until `done`, `error`, or `stopped`.
7. The daemon closes the connection.

### Stop playback immediately

1. Connect to the Unix socket.
2. Send `stop`.
3. Read `stopped`.
4. All other pending/active connections also receive `stopped`.

### Check if the daemon is alive

1. Connect to the Unix socket.
2. Send `status`.
3. Read `status` (contains `queueDepth`).
4. The daemon closes the connection.

---

*End of document. For the canonical protocol definitions, see `src/core/daemon-protocol.ts` in the source tree.*
