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
- Keep Claude Code-inspired extension points: local skills and MCP-backed tools

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
- Compact / memory / session restore (basic session persistence and compact boundary are now implemented)

## Current implementation

- `src/index.ts`: CLI entry
- `src/agent-loop.ts`: multi-turn tool-calling loop
- `src/tool.ts`: registration, validation, execution
- `src/tools/*`: `list_files` / `grep_files` / `read_file` / `write_file` / `edit_file` / `patch_file` / `modify_file` / `run_command` / `web_fetch` / `web_search` / `ask_user` / `load_skill`
- `src/config.ts`: uses dedicated `~/.mini-code`
- `src/skills.ts`: scans `.mini-code/skills` and compatible `.claude/skills` directories
- `src/mcp.ts`: launches stdio MCP servers, negotiates framing compatibility, and wraps remote MCP tools into local tool definitions
- `src/background-tasks.ts`: minimal background shell task registry used by `run_command` and the TUI
- `src/manage-cli.ts`: manages persisted MCP configs and installed local skills
- `src/anthropic-adapter.ts`: Anthropic-compatible Messages API adapter
- `src/utils/token-estimator.ts`: structured token accounting. Provider-reported usage is the primary source when available; local estimation is reserved for missing usage and for tail messages after the latest provider usage boundary.
- `src/compact/*`: context compression and auto-compact. Auto-compact uses structured accounting totals, and compaction marks retained pre-compact provider usage stale.
- `src/mock-model.ts`: offline fallback adapter
- `src/permissions.ts`: path, command, and edit approval with allowlist / denylist
- `src/session.ts`: multi-session persistence with append-only JSONL, parentUuid tree structure, compact boundary, session forking, and expiry cleanup
- `src/file-review.ts`: diff review before writing files
- `src/tui/*`: transcript / chrome / input / screen / markdown terminal components

## Why it is good for learning

One strength of MiniCode is that it delivers Claude Code–like behavior and core architectural ideas in a much lighter implementation.

That makes it well suited to:

- Learning the basic pieces of a terminal coding agent
- Studying tool-calling loops
- Understanding permission approval and file review flows
- Seeing how skills and external MCP tools can be added without a heavy plugin platform
- Seeing a lightweight Claude Code-style distinction between foreground tool execution and background shell tasks
- Experimenting with how terminal UIs are organized
- Customizing further on top of a small codebase

## Future improvements

1. A more complete virtual-scrolling transcript
2. Richer input editing behavior
3. A finer-grained tool execution status panel
4. Session history and project memory (session persistence is now implemented; project memory is still planned)
5. Stronger UI componentization
