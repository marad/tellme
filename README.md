# Tell Me 🔊

Local text-to-speech for coding agents — read AI responses aloud using high-quality, offline models. No API keys, no cloud, runs entirely on your CPU.

**Engines:**
- 🇬🇧 **Kokoro** — natural English, 11 voices (82M params, int8 quantized)
- 🇵🇱 **Piper VITS** — Polish, 3 voice variants
- 🔍 **Auto language detection** — switches engine automatically

Works as a **standalone CLI**, a **[Pi](https://github.com/nicepkg/pi) extension**, or with **Claude Code** / **OpenCode** via slash commands.

## Install

```bash
npm install -g tellme
tellme --download          # downloads ~160 MB of models to ~/.tellme/models
```

Or install from source:

```bash
git clone https://github.com/marad/tellme.git
cd tellme
npm install
npx tellme --download
```

### Requirements

- Node.js ≥ 18
- Linux or macOS (x64 / ARM)
- Audio output: PulseAudio or ALSA (Linux), CoreAudio (macOS)
- ~160 MB disk for models
- No GPU needed

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
| `--lang <en\|pl\|auto>` | Force language (default: `auto`) |
| `--voice <name>` | Kokoro EN voice (default: `af_bella`) |
| `--speed <0.5–2.0>` | Speech speed (default: `1.0`) |
| `--pl-model <name>` | Polish voice: `gosia-medium`, `darkman-medium`, `mc_speech-medium` |
| `--list-voices` | List available Kokoro voices |
| `--status` | Show model download status |
| `--raw` | Skip markdown stripping / text cleanup |

## Pi extension

```bash
pi install /path/to/tellme
# or for a quick test:
pi -e /path/to/tellme
```

| Command / shortcut | Description |
|--------------------|-------------|
| `/tellme` | Read last assistant message aloud |
| `/tellme-stop` | Stop playback |
| `/tellme-auto` | Toggle auto-read after every response |
| `/tellme-voice` | Pick a Kokoro voice |
| `/tellme-download` | Download models |
| `/tellme-status` | Show engine status |
| `Ctrl+Shift+S` | Speak / stop toggle |

The LLM can also call the `speak` tool directly.

## Claude Code / OpenCode

```bash
# Claude Code
cp integrations/claude-code/tellme.md ~/.claude/commands/

# OpenCode
cp integrations/opencode/tellme.md ~/.config/opencode/command/
```

Then use the `/tellme` slash command in conversations.

## Audio playback

Streaming audio is piped as raw PCM to a subprocess, keeping TTS generation and playback decoupled:

- **Linux:** `paplay` → `aplay` → `ffplay` → `sox play` (first available)
- **macOS:** `ffplay` → `sox play` (streaming), `afplay` (one-shot fallback)

## License

MIT
