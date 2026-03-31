# MiniCode Architecture

[简体中文](./ARCHITECTURE_ZH.md)

This document describes the lightweight architecture decisions behind `mini-code`.

The goal is not to build a giant all-in-one terminal agent platform. The goal is to keep the execution loop, interaction model, and safety boundaries small, understandable, and practical.

## Design Principles

MiniCode prioritizes these capabilities:

1. a clear `model -> tool -> model` execution loop
2. a focused full-screen terminal workflow
3. directory awareness, permission checks, and dangerous action confirmation
4. a componentized transcript / tool / input UI structure
5. reviewable file modifications before write

MiniCode is designed as a smaller, more hackable terminal coding assistant.

## What We Keep First

The first version keeps only the four most important layers:

1. CLI entry
2. agent loop
3. tool registry
4. tool implementations

Key implementation priorities:

- keep the `model -> tool -> model` loop simple and explicit
- keep a unified tool contract and centralized registration
- keep a message-driven terminal interaction model
- keep path permissions, command permissions, and edit review boundaries

## What We Deliberately Leave Out

These are useful, but not necessary for the shortest working loop:

- a full Ink/React rendering stack
- IDE bridge integrations
- remote sessions
- multi-agent orchestration
- LSP integrations
- plugin marketplaces
- large feature-flag systems
- telemetry and analytics
- session compaction, memory syncing, and restore systems

The point is not that these ideas are bad. The point is that they are not required for a small, stable coding assistant.

## Why the Main Loop Matters

The most important part of a terminal coding assistant is not feature count. It is whether the main loop is clear:

1. accept user input
2. send it to the model
3. let the model choose whether to use tools
4. execute tools
5. feed tool results back
6. produce the final response

Once that loop is stable, additional capabilities can be layered on top.

## Current Project Structure

- `src/index.ts`: CLI entry
- `src/agent-loop.ts`: multi-step model/tool loop with step limits
- `src/tool.ts`: tool registration, validation, and execution
- `src/tools/*`: built-in tools such as file read, search, edit, patch, and command execution
- `src/config.ts`: runtime configuration loading from `~/.mini-code`
- `src/anthropic-adapter.ts`: Anthropic-compatible Messages API adapter
- `src/mock-model.ts`: offline fallback model
- `src/permissions.ts`: path, command, and edit approval rules
- `src/file-review.ts`: diff-based review flow before writes
- `src/tui/*`: transcript, chrome, input, screen, and markdown rendering modules

## Why It Is Useful for Learning

One of MiniCode's strengths is that it delivers Claude Code-like capabilities and architectural patterns in a much lighter implementation.

That makes it useful for:

- learning how terminal coding agents work
- studying tool-calling loops
- understanding approval and file review flows
- experimenting with terminal UI architecture
- building custom coding assistants on top of a small codebase

## Next Steps

Good next iterations include:

1. a more complete virtualized transcript viewport
2. richer prompt editing behavior
3. a more expressive tool status panel
4. project memory and session persistence
5. stronger UI modularity
