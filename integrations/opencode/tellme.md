# Tell Me — Read last response aloud

Use the `tellme` CLI to read text aloud using local TTS models (Kokoro for English, Piper for Polish).

## First time setup
Run this once to download the TTS models:
```bash
npx --prefix ~/.tellme tellme --download
```

## Read the last response
To have the assistant's last response read aloud:
```bash
npx --prefix ~/.tellme tellme "TEXT_TO_READ"
```

Language is auto-detected. Use `--lang pl` or `--lang en` to force.
