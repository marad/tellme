---
id: FEAT-0002
title: TTS daemon streaming protocol
status: draft
depends_on: [FEAT-0001]
---

## Intent

FEAT-0001 introduces a daemon that plays a complete utterance per request: the client sends all text, signals end-of-input, the daemon plays it. But today's in-process `tellme` already supports live streaming — playback begins as the agent is still typing — and that is the feature most agent integrations rely on for responsiveness. The daemon must preserve it. This spec extends the request protocol so that a single connection may deliver text incrementally, with playback starting as soon as the first complete sentence is buffered. Incremental delivery introduces edge cases the one-shot protocol does not have: writers that go silent without closing, runaway connections that never end, stop requests arriving while a stream is mid-flight, and requests piling up behind a long-running streaming connection. This spec covers those.

## Behavior

A streaming request is structurally the same as a one-shot one: a single connection, optional header, then `text` (now arriving in chunks rather than all at once), ended by an end-of-input signal from the client. The new behavior is on the daemon side: it does not wait for end-of-input before starting playback. As soon as the first complete sentence is buffered, the daemon begins synthesizing and speaking it, and continues consuming chunks as they arrive. All text from one connection plays contiguously — chunks from different connections never interleave, which means a second request opened during a streaming connection waits in the queue until the first connection completes (whether by graceful end-of-input, client disconnect, streaming idle timeout, or hard duration cap).

Three failure modes need explicit behavior. If the writer goes silent for too long without closing, the daemon plays out everything it has buffered and then completes — it does not abandon buffered text on idle. If a single connection runs longer than a configured maximum (defense against runaway), the daemon stops accepting more chunks, finishes the sentence in flight, and closes. If the user requests stop while a streaming connection is active, the daemon closes the connection from its side, and the CLI handles that closed write cleanly without producing a stack trace.

## Acceptance criteria

- AC-1 — A single request connection may deliver text incrementally and ends with a client-issued end-of-input signal. The daemon begins playback as soon as the first complete sentence is buffered; it does not wait for end-of-input. All text from one connection plays contiguously.
- AC-2 — If a streaming connection has begun and no further chunks arrive for a configured idle interval, the daemon plays out any already-buffered text, signals completion, and closes. The daemon does not abort mid-utterance and does not discard buffered text on idle.
- AC-3 — A single request connection has a configured maximum total duration. If exceeded, the daemon stops accepting more chunks, finishes the current sentence, signals completion, and closes.
- AC-4 — When the user requests stop while a streaming connection is active, the daemon closes that connection from its side. The CLI handles the closed write cleanly and exits without a stack trace.
- AC-5 — When a request arrives while another connection is open and not yet completed, the new request waits in the queue and begins playing only after the prior connection has signaled completion (whether by graceful end-of-input, client disconnect, idle timeout, or hard duration cap).
- AC-6 — Within a single streaming connection, sentences play as one continuous audio stream with no audible gap or click between consecutive sentences.
- AC-7 — All sentences within a single streaming connection are spoken in the same language. If the request header sets `lang` explicitly, every sentence uses that language. If `lang` is `auto` or absent, the daemon selects one language for the connection from the first sentence and reuses it for all subsequent sentences.

## Out of scope

- Per-request mid-utterance abort. Stop is still global, as in FEAT-0001.
- Backpressure when the queue grows large. A streaming connection that produces text faster than the daemon can play it will buffer; explicit caps are not in this spec.
- Concurrent streaming connections playing simultaneously. The single-output-stream invariant from FEAT-0001 still holds.
- Mid-connection language changes. The connection's language is fixed at the start (either by explicit header or by detection on the first sentence); a streaming connection cannot be mid-stream switched between languages.
