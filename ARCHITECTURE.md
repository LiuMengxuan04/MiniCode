# MiniCode Architecture

[简体中文](./ARCHITECTURE_ZH.md)

This document describes the lightweight architecture decisions behind `mini-code`.
The goal is not to build a giant all-in-one terminal agent platform, but to prioritize the most valuable execution loop, interaction experience, and safety boundaries.

## Design Principles

MiniCode prioritizes these capabilities:

1. the main `model -> tool -> model` loop
2. full-screen TUI interaction rhythm
3. directory awareness, permission checks, and dangerous-action confirmation
4. a componentized transcript / tool / input UI structure
5. a user-reviewable file modification flow

In other words, MiniCode is a smaller, more controllable terminal coding assistant.

## Current implementation focus

- Keep the skeleton of the `model -> tool -> model` loop
- Keep a unified tool contract and centralized registration
- Keep a message-driven terminal interaction rhythm
- Keep safety boundaries: path permissions, command permissions, and write approval

## Planned / not yet built

- Full Ink/React rendering stack
- Bridge / IDE two-way communication
- Remote session
- Task swarm / sub-agent orchestration
- LSP
- Skill marketplace
- More complex permission modes
- Feature-flag system
- Telemetry / analytics
- Compact / memory / session restore

## Current implementation

- `src/index.ts`: CLI entry
- `src/agent-loop.ts`: multi-turn tool-calling loop with a maximum step limit
- `src/tool.ts`: registration, validation, execution
- `src/tools/*`: `list_files` / `grep_files` / `read_file` / `write_file` / `edit_file` / `patch_file` / `modify_file` / `run_command`
- `src/config.ts`: uses dedicated `~/.mini-code`
- `src/anthropic-adapter.ts`: Anthropic-compatible Messages API adapter
- `src/mock-model.ts`: offline fallback adapter
- `src/permissions.ts`: path, command, and edit approval with allowlist / denylist
- `src/file-review.ts`: diff review before writing files
- `src/tui/*`: transcript / chrome / input / screen / markdown terminal components

## Why it is good for learning

One strength of MiniCode is that it delivers Claude Code–like behavior and core architectural ideas in a much lighter implementation.

That makes it well suited to:

- Learning the basic pieces of a terminal coding agent
- Studying tool-calling loops
- Understanding permission approval and file review flows
- Experimenting with how terminal UIs are organized
- Customizing further on top of a small codebase

## Future improvements

1. A more complete virtual-scrolling transcript
2. Richer input editing behavior
3. A finer-grained tool execution status panel
4. Session history and project memory
5. Stronger UI componentization
