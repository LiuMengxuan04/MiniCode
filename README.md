# MiniCode

[简体中文](./README.zh-CN.md)

MiniCode is a lightweight terminal coding assistant for local development workflows.

It focuses on a compact tool loop, practical file operations, and a simple full-screen CLI experience.

One of its main advantages is that it provides Claude Code-like capabilities and architectural ideas in a much lighter implementation, which makes it especially suitable for learning and experimentation.

## Highlights

- Tool-driven coding loop with multi-step execution in a single turn
- File reading, searching, writing, patching, and command execution
- Review-before-write flow for file modifications
- Interactive installer with local configuration storage
- Full-screen terminal UI with command menu, transcript view, and history
- Compatible with Anthropic-style API endpoints
- A lightweight way to study Claude Code-like workflows and architecture

## Installation

```bash
cd mini-code
npm install
npm run install-local
```

The installer will ask for:

- model name
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`

It stores configuration in:

- `~/.mini-code/settings.json`

It also installs a launcher to:

- `~/.local/bin/minicode`

If `~/.local/bin` is not already on your `PATH`, add:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Quick Start

```bash
minicode
```

For local development:

```bash
npm run dev
```

For offline demo mode:

```bash
MINI_CODE_MODEL_MODE=mock npm run dev
```

## Built-in Tools

- `list_files`
- `grep_files`
- `read_file`
- `write_file`
- `edit_file`
- `patch_file`
- `modify_file`
- `run_command`

MiniCode can inspect files, apply edits, and run verification commands inside a terminal workflow.

## Local Commands

- `/help`
- `/tools`
- `/status`
- `/model`
- `/model <name>`
- `/config-paths`

The CLI also supports command suggestions, transcript scrolling, prompt editing, and input history.

## Configuration

Example configuration:

```json
{
  "model": "your-model-name",
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_MODEL": "your-model-name"
  }
}
```

Configuration priority:

1. `~/.mini-code/settings.json`
2. compatible existing local settings
3. process environment variables

## Project Structure

- `src/index.ts`: CLI entry
- `src/agent-loop.ts`: multi-step model/tool loop
- `src/tool.ts`: tool registry and execution
- `src/tools/*`: built-in tools
- `src/tui/*`: terminal UI modules
- `src/config.ts`: runtime configuration loading
- `src/install.ts`: interactive installer

## Architecture

- [Architecture Overview](./ARCHITECTURE.md)
- [架构说明](./ARCHITECTURE_ZH.md)

## Development

```bash
npm run check
```

MiniCode is intentionally small and pragmatic. The goal is to keep the architecture understandable, hackable, and easy to extend.
