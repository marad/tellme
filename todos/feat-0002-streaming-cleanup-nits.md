# FEAT-0002 streaming: small cleanups left over from the sync

Reviewer flagged these during the FEAT-0002 implementation review.
None block the spec; bundle them into a single small cleanup pass.

1. **Dead local in streaming branch.** `chosenSampleRate` (in
   `processItem`'s streaming branch, src/core/daemon-server.ts) is
   captured but never read. Drop it. (Likely subsumed by the
   single-audio-sink follow-up todo.)

2. **No guard against a second `speak` on a streaming connection.**
   The connection reader handles `chunk` and `end` after a streaming
   speak, but if a misbehaving client sent another `speak` frame on
   the same connection while one was in flight, `streamingItem` would
   be overwritten and the prior connection's idle/max timers would
   leak. Add: if `streamingItem` is already set, log/error and ignore
   (or close the socket).

3. **Silent error swallowing in streaming client.**
   `daemon-client.ts` attaches `socket.on("error", () => {})` in the
   streaming path to absorb EPIPE/ECONNRESET cleanly (per AC-4). It
   also silently swallows non-write errors. Add a comment that
   narrows the intent, or filter by `err.code` to only suppress the
   specific connection-closed codes.

4. **Cryptic loop hack.** `src/core/sentence-buffer.ts` has
   `i = start - 1; // -1 because the loop will ++` inside the scan.
   Replace with `i = start; continue;` or rewrite as a `while` loop
   for readability.

5. **Defensive redundancy.** In the streaming branch's `shouldStop`,
   the worker checks both `stopRequested` and `streaming.killed()`.
   `handleStop` already calls `kill()`, so one of them is enough.
   Pick one; comment why if keeping both as defense-in-depth.
