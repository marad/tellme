# Tell Me 🔊

Local text-to-speech for coding agents — read AI responses aloud using high-quality, offline TTS models. No API keys, no cloud, runs entirely on your CPU.

**Engines:**
- 🇬🇧 **Kokoro v0.19** — natural English, 11 voices (82M params, fp32)
- 🇵🇱 **Piper VITS** — Polish, 2 voices (męski / Justyna)
- 🔍 **Auto language detection** — switches engine automatically

Works as a **[Pi](https://github.com/mariozechner/pi) extension** (with live streaming TTS), a **standalone CLI**, or with **Claude Code** / **OpenCode** via slash commands.

## Install

### As a Pi package

```bash
pi install /path/to/tellme
# or for a quick test:
pi -e /path/to/tellme
```

### From source

```bash
git clone https://github.com/marad/tellme.git
cd tellme
npm install
```

### Download models

```bash
npx tellme --download     # ~430 MB total (Kokoro EN + Piper PL)
```

Or in Pi: `/tellme-download`

Models are cached in `~/.tellme/models/`.

### Requirements

- Node.js ≥ 18
- Linux or macOS (x64 / ARM64)
- Audio output: PulseAudio or ALSA (Linux), CoreAudio (macOS)
- ~430 MB disk for models
- `espeak-ng` installed (used by both engines for phonemization)
- No GPU needed

## Pi extension

The Pi extension is the primary integration — it supports **live streaming TTS** that starts reading while the agent is still generating its response.

### Commands

| Command | Description |
|---------|-------------|
| `/tellme` | Read last assistant message aloud |
| `/tellme-stop` | Stop playback |
| `/tellme-auto` | Toggle auto-read (reads every response) |
| `/tellme-lang` | Set language: auto, en, or pl |
| `/tellme-speed` | Set speech speed (0.5x – 2.0x) |
| `/tellme-voice` | Pick Kokoro EN voice |
| `/tellme-plvoice` | Pick Polish voice |
| `/tellme-download` | Download TTS models |
| `/tellme-status` | Show engine status |

### Shortcuts

| Shortcut | Description |
|----------|-------------|
| `Ctrl+Shift+S` | Speak / stop toggle |

### LLM tools

The extension registers two tools the agent can use:

- **`speak`** — Read text aloud (the agent calls this when you ask it to read something)
- **`set_tts_language`** — Switch TTS language (the agent calls this when you say e.g. "odpowiadaj po polsku")

### Live streaming

When auto-read is on (`/tellme-auto`), TTS starts generating audio **while the agent is still streaming its response**. Each completed sentence is sent to the TTS engine immediately — you hear the first sentence before the agent finishes writing.

The status bar shows the current state:

| Status | Meaning |
|--------|---------|
| `🔊 EN+PL [auto]` | Idle, auto-read on, both engines ready |
| `🔊 PL 1.5x` | Idle, Polish forced, speed 1.5x |
| `🔊 ⏳ listening...` | Agent started responding, buffering text |
| `🔊 ▶ live EN [3]` | Generating chunk 3 in real-time |
| `🔊 ▶ playing EN` | Generation done, finishing playback |

### Configuration

Settings are saved to `~/.tellme/config.json` and persist across sessions.
Any change via commands or tools updates the file automatically.

```json
{
  "language": "auto",
  "enVoice": "af_bella",
  "plModel": "meski_wg_glos-medium",
  "speed": 1.0,
  "autoRead": false
}
```

Session-level overrides (from Pi session entries) take precedence over the global config.

## CLI usage

```bash
tellme "Hello, how are you?"
tellme --lang pl "Dzień dobry, jak się masz?"
echo "Some text" | tellme
tellme --voice am_adam "Different voice"
tellme --speed 1.3 "Faster speech"
tellme --list-voices
tellme --status
```

| Option | Description |
|--------|-------------|
| `--download` | Download TTS models |
| `--lang <en\|pl\|auto>` | Force language (default: from config) |
| `--voice <name>` | Kokoro EN voice (default: `af_bella`) |
| `--speed <0.5–2.0>` | Speech speed (default: `1.0`) |
| `--pl-model <name>` | Polish voice: `meski_wg_glos-medium`, `justyna_wg_glos-medium` |
| `--list-voices` | List available Kokoro voices |
| `--status` | Show model download status |
| `--raw` | Skip text preparation (read as-is) |

CLI defaults come from `~/.tellme/config.json` — command-line args override.

## Claude Code / OpenCode

```bash
# Claude Code
cp integrations/claude-code/tellme.md ~/.claude/commands/

# OpenCode
cp integrations/opencode/tellme.md ~/.config/opencode/command/
```

Then use the `/tellme` slash command in conversations.

## Voices

### English (Kokoro)

| Voice | Type | Grade |
|-------|------|-------|
| `af_bella` | 🇺🇸 Female | A- (default) |
| `af_nicole` | 🇺🇸 Female | B- |
| `af_sarah` | 🇺🇸 Female | C+ |
| `af_sky` | 🇺🇸 Female | C- |
| `am_adam` | 🇺🇸 Male | F+ |
| `am_michael` | 🇺🇸 Male | C+ |
| `bf_emma` | 🇬🇧 Female | B- |
| `bf_isabella` | 🇬🇧 Female | C |
| `bm_george` | 🇬🇧 Male | C |
| `bm_lewis` | 🇬🇧 Male | D+ |

### Polish (Piper)

| Voice | Type |
|-------|------|
| `meski_wg_glos-medium` | Male (default) |
| `justyna_wg_glos-medium` | Female |

## Audio playback

Streaming audio is piped as raw PCM to a subprocess player, keeping TTS generation and playback on separate processes to avoid stuttering:

- **Linux:** `paplay` → `aplay` → `ffplay` → `sox play` (first available)
- **macOS:** `ffplay` → `sox play`

## Text preparation

AI responses go through `prepareForSpeech()` before TTS:

- Code blocks → removed
- File paths → filename only (`/home/user/src/app.ts` → "app dot ts")
- Inline code → spoken as words (`camelCase` → "camel case")
- Markdown formatting → stripped
- URLs, tables, emojis → removed
- `--raw` flag skips all of this

## Architecture

```
~/.tellme/
├── config.json                    # Global preferences
└── models/
    ├── kokoro-en-v0_19/           # English (~350 MB)
    └── vits-piper-pl_PL-*/        # Polish (~80 MB each)

src/
├── core/
│   ├── config.ts                  # Config, voices, model definitions
│   ├── tts-engine.ts              # Dual-engine TTS (Kokoro + Piper)
│   ├── audio-player.ts            # Subprocess streaming player
│   ├── language-detect.ts         # PL vs EN detection
│   ├── text-prep.ts               # AI text → speakable text
│   └── model-manager.ts           # Download & extract models
├── cli/index.ts                   # CLI entry point
└── integrations/pi/index.ts       # Pi extension
```

## License

MIT
