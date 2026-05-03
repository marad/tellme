.PHONY: all build install uninstall link unlink integrations test clean help

NPM ?= npm

CLAUDE_COMMANDS_DIR ?= $(HOME)/.claude/commands
OPENCODE_COMMANDS_DIR ?= $(HOME)/.config/opencode/commands

all: build

help:
	@echo "Targets:"
	@echo "  build         Install npm dependencies (TS is loaded at runtime via jiti)"
	@echo "  install       Build, then 'npm link' so 'tellme' is on PATH"
	@echo "  uninstall     Remove the global 'tellme' link"
	@echo "  integrations  Copy Claude Code / OpenCode slash commands"
	@echo "  test          Run the test suite"
	@echo "  clean         Remove node_modules"

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

clean:
	rm -rf node_modules
