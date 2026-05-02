# FEAT-0002 streaming: use one AudioSink per connection, not per sentence

In the streaming branch of `processItem` (src/core/daemon-server.ts:344+),
each detected sentence calls `speakOne` which creates a fresh `AudioSink`
via `createAudioSink(sampleRate)`. So a streaming connection that emits
N sentences opens N audio devices back-to-back.

Functionally fine: AC-1 says "all text from one connection plays
contiguously," and contiguous here means no interleaving with another
request — which the single-worker invariant already guarantees. Tests
pass under `TELLME_TEST_SILENT=1` because the fake sink is per-call too.

The concern is on a real audio device: each sentence pays the
`createStreamingPlayer` setup cost, may produce an audible click or
gap, and undermines the "playback feels live" UX the spec frames
streaming around. The in-process FEAT-0001-era flow uses ONE streaming
player for all chunks from one synthesis call — the streaming daemon
should match that.

Fix sketch:
- In the streaming branch, lazily create the sink on the first
  sentence (so we know `sampleRate`) and reuse it for every subsequent
  sentence.
- Detect language ONCE on the first sentence and reuse for the rest of
  the connection. (Today's one-shot path already does this implicitly
  by detecting on the full text — same effect, simpler implementation,
  matches user expectation that one connection = one language.)
- Drop the unused `chosenSampleRate` local — it was the original
  intent's vestige.
- End the sink only after the channel completes (graceful end / kill /
  idle / max).

Test plan: extend AC-1 test to assert the fake sink was created exactly
once for a multi-sentence streaming connection.

Out of scope when filed:
- Mid-connection language switches (English → Polish in the same
  connection). The spec doesn't require this and today's one-shot
  doesn't either.
