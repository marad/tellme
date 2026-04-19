# Tell Me — Read text aloud with local TTS

Read AI responses aloud using local TTS models. Kokoro for English (11 voices), Piper for Polish (2 voices). No cloud, no API keys.

## Setup

```bash
# Clone and install
git clone https://github.com/marad/tellme.git ~/.tellme/repo
cd ~/.tellme/repo && npm install && npm link

# Download models (~430 MB)
tellme --download
```

After setup, `tellme` is available globally.

## Usage

When the user asks you to read something aloud, or you want to present a response audibly, run:

```bash
# Auto-detect language
tellme "Hello, this will be read aloud"

# Force language
tellme --lang pl "Dzień dobry, to jest test"
tellme --lang en "This is English"

# Pipe text (useful for long content)
echo "Some long text here" | tellme

# Change voice or speed
tellme --voice bm_george "British male voice"
tellme --speed 1.5 "Faster speech"
```

## Voices

English: `af_bella` (default), `af_nicole`, `af_sarah`, `af_sky`, `am_adam`, `am_michael`, `bf_emma`, `bf_isabella`, `bm_george`, `bm_lewis`

Polish: `meski_wg_glos-medium` (default, male), `justyna_wg_glos-medium` (female)

## Options

| Option | Description |
|--------|-------------|
| `--lang <en\|pl\|auto>` | Force language (default: from `~/.tellme/config.json`) |
| `--voice <name>` | Kokoro EN voice |
| `--speed <0.5–2.0>` | Speech speed |
| `--pl-model <name>` | Polish voice model |
| `--raw` | Skip text cleanup (read markdown as-is) |

## Stop playback

```bash
pkill -f "paplay\|aplay\|ffplay"
```
