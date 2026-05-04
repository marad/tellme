.PHONY: all build install uninstall link unlink integrations test clean help \
        vendor-libs compile

NPM ?= npm
BUN ?= bun

# Default to host platform; override with `make compile PLATFORM=linux-arm64` etc.
HOST_OS := $(shell uname -s | tr '[:upper:]' '[:lower:]')
HOST_ARCH := $(shell uname -m)
ifeq ($(HOST_OS),darwin)
  DEFAULT_PLATFORM := darwin-$(if $(filter arm64,$(HOST_ARCH)),arm64,x64)
else
  DEFAULT_PLATFORM := linux-$(if $(filter aarch64 arm64,$(HOST_ARCH)),arm64,x64)
endif
PLATFORM ?= $(DEFAULT_PLATFORM)

# Map platform → npm package name (sherpa-onnx publishes one per arch)
SHERPA_PKG_linux-x64    := sherpa-onnx-linux-x64
SHERPA_PKG_linux-arm64  := sherpa-onnx-linux-arm64
SHERPA_PKG_darwin-x64   := sherpa-onnx-darwin-x64
SHERPA_PKG_darwin-arm64 := sherpa-onnx-darwin-arm64
SHERPA_PKG := $(SHERPA_PKG_$(PLATFORM))

# Map platform → bun --target value
BUN_TARGET_linux-x64    := bun-linux-x64
BUN_TARGET_linux-arm64  := bun-linux-arm64
BUN_TARGET_darwin-x64   := bun-darwin-x64
BUN_TARGET_darwin-arm64 := bun-darwin-arm64
BUN_TARGET := $(BUN_TARGET_$(PLATFORM))

CLAUDE_COMMANDS_DIR ?= $(HOME)/.claude/commands
OPENCODE_COMMANDS_DIR ?= $(HOME)/.config/opencode/commands

all: build

help:
	@echo "Targets:"
	@echo "  build           Install npm dependencies (TS is loaded at runtime via jiti)"
	@echo "  install         Build, then 'npm link' so 'tellme' is on PATH"
	@echo "  uninstall       Remove the global 'tellme' link"
	@echo "  integrations    Copy Claude Code / OpenCode slash commands"
	@echo "  vendor-libs     Stage sherpa-onnx shared libs into vendor/ for embedding"
	@echo "  compile         bun build --compile → dist/tellme (single binary)"
	@echo "  test            Run the test suite"
	@echo "  clean           Remove node_modules and dist"
	@echo ""
	@echo "Variables:"
	@echo "  PLATFORM=$(PLATFORM)  (override: linux-x64 | linux-arm64 | darwin-x64 | darwin-arm64)"

build: node_modules

node_modules: package.json package-lock.json
	$(NPM) install
	@touch node_modules

install: build link

link:
	$(NPM) link

uninstall unlink:
	-$(NPM) unlink -g tellme

integrations:
	mkdir -p "$(CLAUDE_COMMANDS_DIR)" "$(OPENCODE_COMMANDS_DIR)"
	cp integrations/claude-code/tellme.md "$(CLAUDE_COMMANDS_DIR)/"
	cp integrations/opencode/tellme.md "$(OPENCODE_COMMANDS_DIR)/"

test: build
	$(NPM) test

# Stage prebuilt sherpa-onnx shared libs into vendor/ where the embed module
# imports them.  Requires the matching platform package to be installed under
# node_modules/ (npm install sherpa-onnx-node will pull in the host arch as an
# optional dependency; cross-arch builds need an explicit `npm install
# $(SHERPA_PKG) --no-save`).
vendor-libs:
	@if [ -z "$(SHERPA_PKG)" ]; then \
		echo "Unsupported PLATFORM=$(PLATFORM)"; exit 1; \
	fi
	@if [ ! -d node_modules/$(SHERPA_PKG) ]; then \
		echo "Missing node_modules/$(SHERPA_PKG) — run: $(NPM) install $(SHERPA_PKG) --no-save"; \
		exit 1; \
	fi
	mkdir -p vendor/sherpa-libs/$(PLATFORM)
	cp node_modules/$(SHERPA_PKG)/libsherpa-onnx-c-api.* vendor/sherpa-libs/$(PLATFORM)/
	cp node_modules/$(SHERPA_PKG)/libsherpa-onnx-cxx-api.* vendor/sherpa-libs/$(PLATFORM)/
	cp node_modules/$(SHERPA_PKG)/libonnxruntime.* vendor/sherpa-libs/$(PLATFORM)/
	@echo "vendor/sherpa-libs/$(PLATFORM)/ populated."

compile: vendor-libs
	@if [ -z "$(BUN_TARGET)" ]; then \
		echo "Unsupported PLATFORM=$(PLATFORM)"; exit 1; \
	fi
	mkdir -p dist
	$(BUN) build --compile --target=$(BUN_TARGET) src/cli/index.ts \
		--outfile dist/tellme \
		--external sherpa-onnx-node
	@echo ""
	@ls -lh dist/tellme

clean:
	rm -rf node_modules dist vendor
