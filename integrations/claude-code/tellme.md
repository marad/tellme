# Tell Me — Read text aloud with local TTS

Read AI responses aloud using local TTS models. Kokoro for English (11 voices), Piper for Polish (2 voices). No cloud, no API keys.

## Setup

Install once from the tellme repo:
```bash
cd /path/to/tellme && npm install
npx tellme --download    # downloads ~430 MB of models
```

## Read text aloud

```bash
# Auto-detect language
npx tellme "Hello, this will be read aloud"

# Force language
npx tellme --lang pl "Dzień dobry, to jest test"
npx tellme --lang en "This is English"

# Pipe text
echo "Some text" | npx tellme

# Change voice
npx tellme --voice af_bella "Female American voice"
npx tellme --voice bm_george "Male British voice"

# Change speed
npx tellme --speed 1.5 "Faster speech"

# Polish voice
npx tellme --lang pl --pl-model justyna_wg_glos-medium "Głos Justyny"
```

## Available voices

English (Kokoro): `af_bella` (default), `af_nicole`, `af_sarah`, `af_sky`, `am_adam`, `am_michael`, `bf_emma`, `bf_isabella`, `bm_george`, `bm_lewis`

Polish (Piper): `meski_wg_glos-medium` (default, male), `justyna_wg_glos-medium` (female)

## Stop playback

Press Ctrl+C or:
```bash
pkill -f "paplay\|aplay\|ffplay"
```

## Options

| Option | Description |
|--------|-------------|
| `--lang <en\|pl\|auto>` | Force language (default: from `~/.tellme/config.json`) |
| `--voice <name>` | Kokoro EN voice |
| `--speed <0.5–2.0>` | Speech speed |
| `--pl-model <name>` | Polish voice model |
| `--raw` | Skip text cleanup (read markdown as-is) |
| `--list-voices` | List available voices |
| `--status` | Show model status |
