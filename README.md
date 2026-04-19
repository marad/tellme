# Tell Me 🔊

Listen to your AI coding agent instead of reading. Tell Me is a local text-to-speech extension that reads assistant responses aloud — no cloud services, no API keys, everything runs on your CPU.

## Why?

When you're working with an AI coding agent, you spend a lot of time waiting for and reading responses. Tell Me lets you **listen instead** — lean back, rest your eyes, or keep working while the agent talks to you. It starts speaking while the response is still being generated, so you don't wait for the full answer.

## Features

- **Live streaming** — starts reading while the agent is still typing
- **Two engines** — Kokoro for English (natural, 11 voices), Piper for Polish (2 voices)
- **Auto language detection** — switches between English and Polish automatically
- **Agent-controlled** — the LLM can switch language or read text aloud via tools
- **Read from clipboard** — select any text, copy, and hear it (`Ctrl+Shift+R`)
- **Configurable** — voice, speed, language — persisted in `~/.tellme/config.json`
- **Cross-platform** — Linux and macOS, x64 and ARM64

## Install

### Pi (recommended)

```bash
pi install https://github.com/marad/tellme
```

Then in any Pi session:
```
/tellme-download          # one-time: downloads ~430 MB of TTS models
/tellme-auto              # toggle auto-read
```

### CLI

```bash
git clone https://github.com/marad/tellme.git
cd tellme && npm install && npm link
tellme --download
tellme "Hello world"
```

### Claude Code / OpenCode

```bash
# After CLI install above:
cp integrations/claude-code/tellme.md ~/.claude/commands/       # Claude Code
cp integrations/opencode/tellme.md ~/.config/opencode/commands/  # OpenCode
```

## Requirements

- Node.js ≥ 18
- `espeak-ng` installed
- Audio: PulseAudio or ALSA (Linux), CoreAudio (macOS)
- ~430 MB disk for models
- No GPU needed

## Quick reference

| Pi command | What it does |
|------------|--------------|
| `/tellme` | Read last response |
| `/tellme-auto` | Toggle auto-read |
| `/tellme-lang` | Set language (auto / en / pl) |
| `/tellme-speed` | Set speed (0.5x – 2.0x) |
| `/tellme-voice` | Pick English voice |
| `/tellme-plvoice` | Pick Polish voice |
| `/tellme-stop` | Stop playback |
| `Ctrl+Shift+S` | Speak / stop toggle |
| `Ctrl+Shift+R` | Read clipboard aloud |

## License

MIT
