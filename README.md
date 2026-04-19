# Tell Me 🔊

Local TTS for coding agents — read AI responses aloud using high-quality local models.

**Dual-engine architecture:**
- 🇬🇧 **Kokoro** (82M params) — natural English speech, 20 voices
- 🇵🇱 **Piper VITS** — Polish speech, multiple voices
- 🔍 **Auto language detection** — switches engine automatically

## Quick Start

### Install & download models

```bash
cd tellme
npm install
npx tellme --download   # Downloads ~160 MB of models
```

### Use as CLI

```bash
npx tellme "Hello, how are you?"
npx tellme --lang pl "Dzień dobry, jak się masz?"
echo "Some text" | npx tellme
npx tellme --voice am_fenrir "Deep voice"
npx tellme --list-voices
```

### Use as Pi extension

```bash
# Install as Pi package
pi install /path/to/tellme

# Or for quick test
pi -e /path/to/tellme
```

Then in Pi:
- `/tellme` — read the last assistant message
- `/tellme-auto` — toggle auto-read after every response
- `/tellme-voice` — pick a Kokoro voice
- `/tellme-stop` — stop playback
- `/tellme-download` — download models
- `/tellme-status` — check engine status
- `Ctrl+Shift+S` — shortcut to speak last message
- The LLM can call the `speak` tool directly

### Use with Claude Code

Copy the slash command:
```bash
cp integrations/claude-code/tellme.md ~/.claude/commands/
```
Then use `/tellme` in Claude Code conversations.

### Use with OpenCode

Copy the custom command:
```bash
cp integrations/opencode/tellme.md ~/.config/opencode/command/
```

## Configuration

### Kokoro EN voices

| Voice | Type | Grade |
|-------|------|-------|
| `af_heart` ⭐ | Female | A |
| `af_bella` | Female | A- |
| `af_nicole` | Female | B- |
| `am_fenrir` | Male | C+ |
| `am_michael` | Male | C+ |
| `am_puck` | Male | C+ |

Full list: `npx tellme --list-voices`

### CLI options

| Option | Description |
|--------|-------------|
| `--download` | Download TTS models |
| `--lang <en\|pl\|auto>` | Force language |
| `--voice <name>` | Kokoro voice (default: af_heart) |
| `--speed <0.5-2.0>` | Speech speed |
| `--pl-model <name>` | Polish voice variant |
| `--status` | Show model status |

### Polish voices

| Model | Description |
|-------|-------------|
| `darkman-medium` (default) | Male voice |
| `gosia-medium` | Female voice |
| `mc_speech-medium` | Male voice |

## Architecture

```
tellme/
├── src/
│   ├── core/                  # Shared TTS engine
│   │   ├── tts-engine.ts      # Kokoro + Piper wrapper
│   │   ├── model-manager.ts   # Download & cache models
│   │   ├── audio-player.ts    # Cross-platform playback
│   │   ├── language-detect.ts # PL vs EN detection
│   │   └── text-prep.ts       # Markdown stripping
│   ├── cli/                   # Standalone CLI
│   │   └── index.ts
│   └── integrations/
│       └── pi/                # Pi extension
│           └── index.ts
├── integrations/
│   ├── claude-code/           # Claude Code slash command
│   └── opencode/              # OpenCode custom command
└── bin/
    └── tellme.js              # CLI entry point
```

## Requirements

- **Node.js** >= 18
- **Linux** or **macOS** (x64 or ARM)
- ~160 MB disk for models (downloaded on first use)
- No GPU required — runs on CPU
- Audio output: PulseAudio/ALSA (Linux), CoreAudio (macOS)

## How it works

1. **sherpa-onnx-node** — native C++ addon for ONNX model inference
   - Prebuilt binaries for linux-x64, linux-arm64, darwin-x64, darwin-arm64
2. **Kokoro** — 82M parameter TTS model, int8 quantized (~99 MB)
3. **Piper VITS** — lightweight TTS trained on Polish speech data (~64 MB)
4. **speaker** npm — direct PCM audio output (fallback: ffplay/afplay/aplay)
5. **Language detection** — heuristic based on Polish characters and common words

## License

MIT
