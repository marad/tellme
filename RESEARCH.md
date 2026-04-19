# Tell Me — Research: Lokalne modele TTS i architektura projektu

## 1. Cel projektu

Rozszerzenie/narzędzie **Tell Me**, które czyta na głos ostatnią wiadomość asystenta AI. Wymagania:
- Lokalne modele TTS (bez chmury)
- Wysoka jakość głosu (brzmi naturalnie)
- Działa na **Linux** i **macOS**
- Integracja z **Pi**, **Claude Code** i **OpenCode**

---

## 2. Porównanie lokalnych modeli TTS

### 2.1. Kokoro TTS (82M parametrów) ⭐ REKOMENDOWANY

| Cecha | Wartość |
|-------|---------|
| **Jakość** | Bardzo wysoka — porównywalna z dużymi modelami komercyjnymi |
| **Rozmiar** | 82M parametrów, ~305 MB (fp32), ~140 MB (int8) |
| **Szybkość** | Bardzo szybki na CPU, real-time na RTX 4070 |
| **Języki** | EN (US/UK), JA, ZH, ES, FR, HI, IT, PT-BR |
| **Głosy** | 20 angielskich (11F, 9M), + inne języki |
| **Licencja** | Apache 2.0 |
| **Integracja Node.js** | ✅ Przez `sherpa-onnx-node` (natywny addon) lub `kokoro-js` (ONNX w JS) |
| **Linux** | ✅ |
| **macOS** | ✅ (x64 + ARM/Apple Silicon) |

**Najlepsza jakość głosów (EN):**
- `af_heart` — Grade A, najlepszy żeński głos
- `af_bella` — Grade A-, gorący ton
- `am_fenrir` — Grade C+, najlepszy męski

**Dlaczego Kokoro:**
- Najlepsza relacja jakość/rozmiar na rynku w 2025/2026
- Natywny pakiet npm `sherpa-onnx-node` z prekompilowanymi binariami na wszystkie platformy
- Streaming audio (generacja + odtwarzanie równolegle)
- Mały model — szybki start, niskie zużycie pamięci

### 2.2. Piper TTS (VITS)

| Cecha | Wartość |
|-------|---------|
| **Jakość** | Dobra, ale wyraźnie gorsza niż Kokoro |
| **Rozmiar** | 15-65 MB na model (wiele głosów) |
| **Szybkość** | Bardzo szybki na CPU |
| **Języki** | 30+ (w tym polski!) |
| **Integracja Node.js** | Przez `sherpa-onnx-node` (VITS backend) lub jako subprocess (C++ binary) |
| **Linux** | ✅ (binary + packages) |
| **macOS** | ✅ (binary dostępny x64 + ARM) |

**Zalety:** Mały, szybki, ogromna ilość głosów i języków, dojrzały projekt.
**Wady:** Głos brzmi mniej naturalnie niż Kokoro — ma "robotyczny" posmak.

### 2.3. Supertonic TTS (nowy, 2026)

| Cecha | Wartość |
|-------|---------|
| **Jakość** | Obiecująca, jeszcze mało próbek |
| **Rozmiar** | ~81 MB (int8) |
| **Szybkość** | Szybki |
| **Integracja Node.js** | ✅ Przez `sherpa-onnx-node` |
| **Linux/macOS** | ✅ |

Bardzo nowy model — brak wystarczających porównań jakościowych. Warto obserwować.

### 2.4. F5-TTS (Diffusion Transformer)

| Cecha | Wartość |
|-------|---------|
| **Jakość** | Bardzo wysoka — klonowanie głosu |
| **Rozmiar** | ~800 MB+ |
| **Szybkość** | Wolny (wymaga GPU) |
| **Integracja Node.js** | ❌ Tylko Python |
| **Linux** | ✅ |
| **macOS** | ✅ (z MPS fallback) |

**Wady:** Wymaga Pythona, PyTorch, duży model, wolny bez GPU. Nie nadaje się do szybkiego odczytu w CLI.

### 2.5. Bark (Suno)

| Cecha | Wartość |
|-------|---------|
| **Jakość** | Naturalna, z emocjami, ale niestabilna |
| **Rozmiar** | ~5 GB |
| **Szybkość** | Bardzo wolny (sekundy na zdanie) |
| **Integracja Node.js** | ❌ Tylko Python |

**Wady:** Za wolny, za duży, niestabilny. Nie nadaje się.

### 2.6. kokoro-js (JavaScript/ONNX)

| Cecha | Wartość |
|-------|---------|
| **Jakość** | Ta sama co Kokoro (ten sam model) |
| **Rozmiar** | ~30 MB pakiet + model ~305 MB |
| **Szybkość** | Wolniejszy niż native (ONNX runtime w JS) |
| **Integracja Node.js** | ✅ Natywny npm pakiet |

Alternatywa dla sherpa-onnx-node — ten sam model Kokoro, ale inference w JavaScript/WASM.
Wolniejszy niż natywny addon, ale prostszy w instalacji (zero compile).

---

## 3. Rekomendacja modelu

### Wybór: **Kokoro TTS przez sherpa-onnx-node**

Powody:
1. **Najlepsza jakość** wśród lekkich modeli — naturalne brzmienie
2. **Natywny Node.js addon** — `sherpa-onnx-node` z prekompilowanymi binariami:
   - `sherpa-onnx-linux-x64`
   - `sherpa-onnx-linux-arm64`
   - `sherpa-onnx-darwin-arm64` (Apple Silicon)
   - `sherpa-onnx-darwin-x64` (Intel Mac)
3. **Streaming** — generacja i odtwarzanie równolegle (nie trzeba czekać na cały plik)
4. **Mały rozmiar** — int8 multi-lang: ~140 MB, en-only: ~99 MB
5. **Apache 2.0** — bez ograniczeń

### Model do pobrania

**Dla angielskiego (mniejszy, szybszy):**
```
kokoro-int8-en-v0_19.tar.bz2 (98.5 MB)
```

**Dla wielu języków (uniwersalny):**
```
kokoro-int8-multi-lang-v1_1.tar.bz2 (140.2 MB)
```

Rekomendacja: zacznij od **int8 en**, z opcją upgrade do multi-lang.

---

## 4. Architektura projektu — kompatybilność z Pi, Claude Code i OpenCode

### 4.1. Analiza systemów rozszerzeń

| Agent | Mechanizm rozszerzeń | Wspólny mianownik |
|-------|---------------------|-------------------|
| **Pi** | Natywne rozszerzenia TypeScript (`ExtensionAPI`, eventy, toole) | MCP, CLI |
| **Claude Code** | Hooks (`PostToolUse`, `SessionStart`), Custom commands (`~/.claude/commands/*.md`), MCP, Plugins | MCP, CLI, Hooks |
| **OpenCode** | Custom commands (`~/.config/opencode/command/*.md`), MCP, Plugins | MCP, CLI |

### 4.2. Wspólne podejścia

#### Opcja A: CLI + natywne integracje (REKOMENDOWANA)

```
tellme/
├── package.json           # Pi package manifest + npm dependencies
├── README.md
├── RESEARCH.md
│
├── core/                  # Współdzielone jądro TTS
│   ├── tts-engine.ts      # Wrapper na sherpa-onnx-node (Kokoro)
│   ├── audio-player.ts    # Odtwarzanie audio (speaker npm package)
│   ├── model-manager.ts   # Pobieranie i cache modeli
│   └── config.ts          # Konfiguracja (głos, prędkość, model)
│
├── cli/                   # Standalone CLI
│   └── tellme.ts          # CLI: `tellme "text"` lub `echo "text" | tellme`
│
├── integrations/
│   ├── pi/                # Pi extension
│   │   └── index.ts       # Rozszerzenie Pi (hook na agent_end, komenda /tellme)
│   ├── claude-code/       # Claude Code integration
│   │   ├── hook.sh        # Hook script for PostToolUse / custom approach
│   │   └── command.md     # Custom slash command /tellme
│   └── opencode/          # OpenCode integration
│       └── command.md     # Custom slash command
│
└── models/                # Cache pobranych modeli (gitignored)
```

**Dlaczego CLI:**
- **Pi**: Rozszerzenie TypeScript bezpośrednio używa `core/` — najlepsza integracja
- **Claude Code**: Hooks mogą wywołać CLI (`tellme`), slash command `/tellme` wywoła LLM które uruchomi bash z `tellme`
- **OpenCode**: Custom command wywoła CLI
- CLI jest **uniwersalny** — każdy agent potrafi uruchomić polecenie bash

#### Opcja B: MCP Server

Wspólny MCP server z toolem `speak`. Wszystkie trzy agenty obsługują MCP.

**Wady:** Overhead MCP protokołu, potrzeba konfiguracji serwera dla każdego agenta, mniej natywna integracja z Pi.

#### Opcja C: Tylko CLI

Najprostsza — sam CLI, bez rozszerzeń. Agent po prostu wywołuje `tellme` przez bash.

**Wady:** Brak automatycznego czytania, użytkownik musi poprosić o wywołanie.

### 4.3. Decyzja: Opcja A (CLI + natywne integracje)

Daje najlepsze doświadczenie w każdym agencie:
- **Pi**: Automatyczne czytanie po każdej odpowiedzi (event `agent_end`), komenda `/tellme`, shortcut
- **Claude Code / OpenCode**: CLI wywoływany z hooków lub ręcznie

---

## 5. Odtwarzanie audio — cross-platform

### Linux
- **PulseAudio** (`paplay`) — obecny na tym systemie ✅
- **ALSA** (`aplay`) — dostępny ✅
- **PipeWire** — kompatybilny z PulseAudio API

### macOS
- **CoreAudio** — wbudowany
- **`afplay`** — CLI do odtwarzania audio, dostępny na każdym Macu

### Podejście w Node.js

Pakiet npm **`speaker`** (`npm:speaker@0.5.5`):
- Obsługuje ALSA, PulseAudio, CoreAudio
- Wymaga kompilacji natywnej (node-gyp) — **problematyczne**

**Alternatywne podejście (prostsze):**
1. Generuj WAV do pliku tymczasowego
2. Odtwarzaj przez `ffplay -nodisp -autoexit` (Linux) lub `afplay` (macOS)
3. Lub użyj `paplay` (Linux PulseAudio)

**Jeszcze lepiej:** `sherpa-onnx-node` ma wbudowany streaming z callback `onProgress` — można pisać próbki do stdout i pipe'ować do playera.

### Rekomendacja playbacku

Podejście hybrydowe:
1. **Pierwsze podejście:** Użyj `speaker` npm package (natywny PCM output)
2. **Fallback:** Zapisz WAV → `ffplay`/`afplay`/`aplay`

Pakiet `speaker` ma prebuild na popularne platformy, więc kompilacja nie będzie zwykle potrzebna. Ale na wszelki wypadek trzeba mieć fallback.

---

## 6. Wymagania systemowe

### Linux
- `libasound2-dev` (ALSA headers) — do kompilacji `speaker`, zwykle zainstalowane
- Lub `pulseaudio` / `pipewire` — zwykle zainstalowane
- Alternatywnie: `ffplay` (FFmpeg) — dostępny na tym systemie ✅

### macOS
- Xcode Command Line Tools (zwykle zainstalowane)
- `afplay` — wbudowany w macOS

### Wspólne
- Node.js >= 18
- ~150-300 MB miejsca na model TTS (jednorazowe pobranie)
- Brak wymagań GPU — działa na CPU

---

## 7. Plan implementacji

### Faza 1: Core + CLI
1. Zainicjalizuj projekt npm z TypeScript
2. Zaimplementuj `model-manager.ts` — pobieranie Kokoro z GitHub releases
3. Zaimplementuj `tts-engine.ts` — wrapper na sherpa-onnx-node
4. Zaimplementuj `audio-player.ts` — cross-platform playback
5. Zaimplementuj CLI `tellme` — pipe lub argument

### Faza 2: Pi Extension
1. Zaimplementuj rozszerzenie Pi z:
   - Event handler `agent_end` — auto-czytanie
   - Komenda `/tellme` — manualne czytanie
   - Komenda `/tellme-stop` — zatrzymanie
   - Komenda `/tellme-voice` — wybór głosu
   - Shortcut (np. `ctrl+shift+s` — speak)
2. Opublikuj jako Pi package

### Faza 3: Claude Code + OpenCode
1. Claude Code: hook script + slash command
2. OpenCode: custom command

### Faza 4: Polish
1. Konfiguracja (głos, prędkość, auto-read)
2. Obsługa długich wiadomości (streaming)
3. Markdown stripping (nie czytaj formatowania)
4. Testy na macOS

---

## 8. Kluczowe pakiety npm

| Pakiet | Wersja | Cel |
|--------|--------|-----|
| `sherpa-onnx-node` | 1.12.38 | TTS engine (Kokoro model) |
| `speaker` | 0.5.5 | PCM audio output (cross-platform) |
| `@sinclair/typebox` | * | Schema dla Pi extension tools |

Platformowe binaria (optional deps, automatycznie instalowane):
- `sherpa-onnx-linux-x64`
- `sherpa-onnx-linux-arm64`
- `sherpa-onnx-darwin-arm64`
- `sherpa-onnx-darwin-x64`

---

## 9. Ryzyko i mitygacja

| Ryzyko | Mitygacja |
|--------|-----------|
| `speaker` nie kompiluje się | Fallback: zapis WAV + `ffplay`/`afplay` |
| Model za duży do pobrania | Użyj int8 (~140 MB), lazy download |
| Brak polskiego w Kokoro | Piper jako fallback engine (ma polski) |
| Kokoro brzmi źle na krótkich tekstach | Buforuj krótkie fragmenty, łącz zdania |
| macOS Gatekeeper blokuje binaria | sherpa-onnx-node jest podpisany w npm |
