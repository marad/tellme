---
id: FEAT-0003
title: TTS daemon lifecycle management
status: draft
depends_on: [FEAT-0001]
---

## Intent

FEAT-0001 introduces a daemon the user must start explicitly with `tellme daemon start`. That works for power users but defeats the daemon's value for the common case: an AI agent shells out `tellme "..."` from a slash command, the daemon isn't running, the call falls back to in-process and pays the model-load cost — which is exactly the problem the daemon was supposed to solve. For plugins to benefit transparently, without each user setting up a launchd or systemd unit, the CLI should manage the daemon's lifecycle: auto-spawn it on first request, exit it after a period of inactivity so it doesn't sit resident forever, and offer a clear opt-out for users who would rather keep the original in-process behavior.

## Behavior

When `tellme "..."` is invoked and no daemon is detected at the expected socket path, the CLI starts the daemon as a detached process, waits for it to accept connections, and forwards the request. From the user's perspective the call is slightly slower the first time (model load) and instant from then on — the same shape as today's first invocation, just shifted into the daemon. Subsequent invocations from any process find the running daemon and reuse it.

The daemon watches its own queue. After a configured period during which the queue has been continuously empty, it exits cleanly so it does not hold ~430 MB of model memory indefinitely on idle systems. The next request after a shutdown re-triggers auto-spawn.

Users who do not want a daemon at all can set `TELLME_NO_DAEMON=1` (or the equivalent config setting). With this set, the CLI does not auto-spawn, does not contact an existing daemon, and runs entirely in-process — matching the behavior shipped before FEAT-0001.

## Acceptance criteria

- AC-1 — Given the daemon is not running, when `tellme "..."` is invoked, the CLI auto-spawns the daemon as a detached process, waits for it to accept connections, and forwards the request. Subsequent invocations from the same or other processes reuse the running daemon.
- AC-2 — When the daemon's queue has been empty for a configured idle interval, the daemon exits on its own. A subsequent `tellme "..."` invocation re-triggers auto-spawn.
- AC-3 — When the user sets `TELLME_NO_DAEMON=1` (or the equivalent configuration), the CLI does not auto-spawn or contact a daemon and runs entirely in-process, matching pre-daemon behavior.

## Out of scope

- Restart-on-crash supervision. If the daemon crashes mid-request, the next CLI invocation will auto-spawn a fresh one, but in-flight requests are not recovered.
- Per-platform service integration (launchd plist, systemd user unit). Auto-spawn is plain process spawn; users who want OS-managed lifecycle can wrap `tellme daemon start` themselves.
- Hot config reload signals. Configuration changes are picked up on the next daemon start.
