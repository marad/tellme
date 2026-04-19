# Tell Me — Read last response aloud

Use the `tellme` CLI to read text aloud using local TTS models (Kokoro for English, Piper for Polish).

## First time setup
Run this once to download the TTS models:
```bash
npx --prefix ~/.tellme tellme --download
```

## Read the last response
To read the last assistant response aloud, run:
```bash
# Get the last response from the conversation and pipe it to tellme
# The user will invoke this manually when they want to hear the response
npx --prefix ~/.tellme tellme "$LAST_RESPONSE_TEXT"
```

## Stop playback
Press Ctrl+C in the terminal running tellme, or:
```bash
pkill -f tellme
```
