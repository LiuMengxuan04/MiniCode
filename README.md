# MiniCode

<p align="center">
  <img src="./docs/logo.svg" alt="MiniCode Logo" width="180" />
</p>

<h2 align="center">MiniCode</h2>

<p align="center">
  <img src="https://img.shields.io/badge/Editor-Minicode-D97757?style=for-the-badge" alt="Editor: Minicode" />
  <img src="https://img.shields.io/badge/%23minicode-Project-B85C3F?style=for-the-badge" alt="#minicode" />
  <img src="https://img.shields.io/badge/%23lightweight-Focus-F0EBE1?style=for-the-badge&labelColor=8B8B8B" alt="#lightweight" />
</p>

---

<p align="center">
  A lightweight, highly efficient coding tool. Designed for speed, built for simplicity.
</p>

[简体中文](./README.zh-CN.md) | [DeepWiki](https://deepwiki.com/LiuMengxuan04/MiniCode) | [Architecture](./ARCHITECTURE.md) | [Contributing](./CONTRIBUTING.md) | [Roadmap](./ROADMAP.md) | [Learn Claude Code Design Through MiniCode](./CLAUDE_CODE_PATTERNS.md) | [License](./LICENSE)

A lightweight terminal coding assistant for local development workflows.

MiniCode provides Claude Code-like workflow and architectural ideas in a much smaller implementation, making it especially useful for learning, experimentation, and custom tooling.

You can also explore this project through [DeepWiki](https://deepwiki.com/LiuMengxuan04/MiniCode).

## Overview

MiniCode is built around a practical terminal-first agent loop:

- accept a user request
- inspect the workspace
- call tools when needed
- review file changes before writing
- return a final response in the same terminal session

The project is intentionally compact, so the control flow, tool model, and TUI behavior remain easy to understand and extend.

## Multi-language Versions

- TypeScript (this repo): [MiniCode](https://github.com/LiuMengxuan04/MiniCode)
- Rust version: [MiniCode-rs (latest)](https://github.com/harkerhand/MiniCode-rs/tree/master)
- Python version: [MiniCode-Python](https://github.com/QUSETIONS/MiniCode-Python)

## Branch Highlights

- TypeScript version: the reference implementation for MiniCode's core workflow, documentation, and product showcase. More branch-specific features are still being shaped.
- Rust version: keeps conversation history inside the working directory, making it easier to move or migrate a project without losing its local MiniCode context.
- Python version: a Python-native implementation branch. More branch-specific features are still being shaped.

## Table of Contents

- [Product Showcase Page](#product-showcase-page)
- [Why MiniCode](#why-minicode)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [Skills and MCP Usage](#skills-and-mcp-usage)
- [Star History](#star-history)
- [Project Structure](#project-structure)
- [Architecture Docs](#architecture-docs)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [Learn Claude Code Design Through MiniCode](#learn-claude-code-design-through-minicode)
- [Development](#development)

## Product Showcase Page

- Open [docs/index.html](./docs/index.html) in a browser for a visual product overview.
- GitHub Pages (recommended): `https://liumengxuan04.github.io/MiniCode/`

## Why MiniCode

MiniCode is a good fit if you want:

- a lightweight coding assistant instead of a large platform
- a terminal UI with tool calling, transcript, and command workflow
- a small codebase that is suitable for study and modification
- a reference implementation for Claude Code-like agent architecture

## Features

### Core workflow

- multi-step tool execution in a single turn
- model -> tool -> model loop
- full-screen terminal interface
- input history, transcript scrolling, and slash command menu
- discoverable local skills via `SKILL.md`
- dynamic MCP tool loading over stdio
- MCP resources and prompts via generic MCP helper tools

### Built-in tools

- `list_files`
- `grep_files`
- `read_file`
- `write_file`
- `edit_file`
- `patch_file`
- `modify_file`
- `run_command`
- `web_fetch`
- `web_search`
- `ask_user`
- `load_skill`
- `list_mcp_resources`
- `read_mcp_resource`
- `list_mcp_prompts`
- `get_mcp_prompt`

### Safety and usability

- review-before-write flow for file modifications
- path and command permission checks
- local installer with independent config storage
- support for Anthropic-style API endpoints

### Recent interaction upgrades

- approval prompts now use Up/Down selection with Enter confirm
- approval prompts also support direct letter/number shortcuts shown in each option
- supports "reject with guidance" to send corrective instructions back to the model
- edit approvals support "allow this file for this turn" and "allow all edits for this turn"
- file review now uses standard unified diff output (closer to `git diff`)
- approval view supports `Ctrl+O` expand/collapse plus wheel/page scrolling
- `Ctrl+C` now exits cleanly even when an approval prompt is open
- finished tool calls auto-collapse into concise summaries to reduce transcript noise
- explicit background shell commands launched through `run_command` are now surfaced as lightweight shell tasks instead of remaining stuck as a forever-running tool call
- TTY input handling is serialized, and CRLF Enter sequences are normalized so approval confirms do not accidentally fire twice
- fixed an input-event deadlock where approval prompts could stop accepting Up/Down/Enter
- escape-sequence parsing is hardened so malformed terminal input does not stall key handling
- `run_command` now accepts single-string invocations like `"git status"` and auto-splits args
- clarifying questions are now structured via `ask_user`, and the turn pauses until the user replies
- context accounting is now provider-usage-driven: provider-reported usage anchors the context stats, auto-compact trigger, blocking/warning levels, and TUI context badge; the local estimator is used only when provider usage is unavailable or for messages added after the latest usage boundary
- the TUI context badge distinguishes exact provider usage from estimated tail text, for example `ctx 82% ... usage+est`; compacted conversations mark retained pre-compact usage stale so it is not reused as current context truth

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

Configuration is stored in:

- `~/.mini-code/settings.json`
- `~/.mini-code/mcp.json`

You can override the config directory with `MINI_CODE_HOME`:

```bash
export MINI_CODE_HOME=/path/to/custom/dir
npm run install-local
```

The launcher is installed to:

- `~/.local/bin/minicode`

You can override the launcher directory with `MINI_CODE_BIN_DIR`:

```bash
export MINI_CODE_BIN_DIR=/path/to/custom/bin
npm run install-local
```

If `~/.local/bin` is not already on your `PATH`, add:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Quick Start

Run the installed launcher:

```bash
minicode
```

Run in development mode:

```bash
npm run dev
```

Run in offline demo mode:

```bash
MINI_CODE_MODEL_MODE=mock npm run dev
```

## Commands

### Management commands

- `minicode mcp list`
- `minicode mcp add <name> [--project] [--protocol <mode>] [--url <endpoint>] [--header KEY=VALUE ...] [--env KEY=VALUE ...] [-- <command> [args...]]`
- `minicode mcp login <name> --token <bearer-token>`
- `minicode mcp logout <name>`
- `minicode mcp remove <name> [--project]`
- `minicode skills list`
- `minicode skills add <path> [--name <name>] [--project]`
- `minicode skills remove <name> [--project]`

### Local slash commands

- `/help`
- `/tools`
- `/skills`
- `/mcp`
- `/status`
- `/model`
- `/model <name>`
- `/config-paths`

### Terminal interaction

- command suggestions and slash menu
- transcript scrolling
- prompt editing
- input history navigation
- approval selection and feedback input flow (Up/Down + Enter, or key shortcuts)

### Session management

MiniCode automatically saves your conversation after each turn. Each launch creates a new session with a unique ID.

- `/resume` — open interactive session picker
- `/resume <id>` — resume a specific session by ID
- `/rename <name>` — rename the current session
- `/new` — start a fresh session (previous session is preserved)
- `/fork` — fork the current session into a new independent copy
- `/compact` — compress context to free up context window space

CLI flags:

- `minicode --resume` — launch with session picker
- `minicode --resume <id>` — resume a specific session
- `minicode --fork <id>` — fork a session and resume the fork

Sessions are scoped per working directory and stored in `~/.mini-code/projects/` using append-only JSONL. On exit, MiniCode prints the session ID so you can resume later. Sessions older than 30 days are automatically cleaned up.

## Configuration

Example configuration:

```json
{
  "model": "your-model-name",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "remote-example": {
      "protocol": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  },
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_MODEL": "your-model-name"
  }
}
```

Project-scoped MCP config is also supported through Claude Code compatible `.mcp.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

For vendor compatibility, MiniCode now auto-negotiates stdio framing:

- standard MCP `Content-Length` framing is tried first
- if that fails, MiniCode falls back to newline-delimited JSON
- you can force a mode per server with `"protocol": "content-length"` or `"protocol": "newline-json"`
- for remote MCP over HTTP, use `"protocol": "streamable-http"` with `"url"` (and optional `"headers"`)
- header values support environment interpolation, e.g. `"Authorization": "Bearer $MCP_TOKEN"`

Remote MCP authentication strategy (lightweight by design):

- use `minicode mcp login <name> --token <bearer-token>` to store a bearer token locally
- use `minicode mcp logout <name>` to clear a stored token
- for now, MiniCode intentionally uses this token-based path instead of a full built-in OAuth callback + refresh state machine
- this keeps the implementation small and aligned with MiniCode's lightweight architecture goals; full OAuth automation may be added later when needed

Skills are discovered from:

- `./.mini-code/skills/<skill-name>/SKILL.md`
- `~/.mini-code/skills/<skill-name>/SKILL.md`
- `./.claude/skills/<skill-name>/SKILL.md`
- `~/.claude/skills/<skill-name>/SKILL.md`

Configuration priority:

1. `~/.mini-code/settings.json`
2. `~/.mini-code/mcp.json`
3. project `.mcp.json`
4. compatible existing local settings
5. process environment variables

## Skills and MCP Usage

MiniCode supports two extension layers:

- `skills`: local workflow instructions, usually described by a `SKILL.md`
- `MCP`: external tool providers that expose tools, resources, and prompts into MiniCode

### Skills: install, inspect, trigger

Install a local skill:

```bash
minicode skills add ~/minimax-skills/skills/frontend-dev --name frontend-dev
```

List installed or discovered skills:

```bash
minicode skills list
```

Inside the interactive UI, you can also run:

```text
/skills
```

to inspect which skills are available in the current session.

If you explicitly mention a skill name, MiniCode will prefer loading it. For example:

```text
Use the frontend-dev skill and directly rebuild the current landing page instead of stopping at a plan.
```

If you want to be even more explicit:

```text
Load the fullstack-dev skill first, then follow its workflow to implement this task.
```

A common pattern is to clone an official or Claude Code-compatible skills repo locally and install from there:

```bash
git clone https://github.com/MiniMax-AI/skills.git ~/minimax-skills
minicode skills add ~/minimax-skills/skills/frontend-dev --name frontend-dev
```

### MCP: install, inspect, trigger

Install a user-scoped MCP server:

```bash
minicode mcp add MiniMax --env MINIMAX_API_KEY=your-key --env MINIMAX_API_HOST=https://api.minimaxi.com -- uvx minimax-coding-plan-mcp -y
```

List configured MCP servers:

```bash
minicode mcp list
```

To configure an MCP server only for the current project, add `--project`:

```bash
minicode mcp add filesystem --project -- npx -y @modelcontextprotocol/server-filesystem .
minicode mcp list --project
```

Inside the interactive UI, run:

```text
/mcp
```

to see which servers are connected, which protocol they negotiated, and how many tools / resources / prompts they expose.

MCP tools are automatically registered as:

```text
mcp__<server_name>__<tool_name>
```

For example, after connecting the MiniMax MCP server you may see:

- `mcp__minimax__web_search`
- `mcp__minimax__understand_image`

These tool names are not hand-written in MiniCode. They appear automatically after a successful MCP connection.

### How to use them in chat

The simplest approach is to just describe the task naturally and let the model decide when to use a skill or MCP tool:

```text
Search for recent Chinese-language resources about MCP and give me 5 representative links.
```

If MiniMax MCP is connected, the model will typically choose `mcp__minimax__web_search`.

If you want a more controlled workflow, name the skill or target capability explicitly:

```text
Use the frontend-dev skill and directly modify the current project files to turn this page into a more complete product landing page.
```

Or:

```text
Use the connected MCP tools to search for the MiniMax MCP guide and summarize what capabilities it provides.
```

### When to use skills vs MCP

- `skills` are better for workflow, conventions, domain-specific instructions, and reusable execution patterns
- `MCP` is better for search, image understanding, browsers, filesystems, databases, and other remote capabilities

A common combination is:

- use a skill such as `frontend-dev` to shape how the work should be done
- use MCP to provide external search, image understanding, or system integrations

### Compatibility notes

MiniCode currently focuses on:

- local `SKILL.md` discovery with `load_skill`
- stdio MCP servers
- MCP tools
- generic helper tools for MCP resources and prompts

For vendor compatibility, MiniCode automatically tries:

- standard `Content-Length` framing
- then falls back to `newline-json` if needed

That means servers such as MiniMax MCP, which use newline-delimited JSON over stdio, can still be connected directly.

## Star History

<a href="https://www.star-history.com/?repos=LiuMengxuan04%2FMiniCode&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=LiuMengxuan04/MiniCode&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=LiuMengxuan04/MiniCode&type=date&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=LiuMengxuan04/MiniCode&type=date&legend=bottom-right" />
 </picture>
</a>

## Learn Claude Code Design Through MiniCode

If you want to study the project as a learning resource, continue with:

- [What Claude Code Design Ideas You Can Learn Through MiniCode](./CLAUDE_CODE_PATTERNS.md)

## Project Structure

- `src/index.ts`: CLI entry
- `src/agent-loop.ts`: multi-step model/tool loop
- `src/tool.ts`: tool registry and execution
- `src/skills.ts`: local skill discovery and loading
- `src/mcp.ts`: stdio MCP client and dynamic tool wrapping
- `src/manage-cli.ts`: top-level `minicode mcp` / `minicode skills` management commands
- `src/tools/*`: built-in tools
- `src/tui/*`: terminal UI modules
- `src/config.ts`: runtime configuration loading
- `src/install.ts`: interactive installer

## Architecture Docs

- [Architecture Overview](./ARCHITECTURE.md)
- [中文架构说明](./ARCHITECTURE_ZH.md)

## Contributing

- [Contribution Guidelines](./CONTRIBUTING.md)
- [中文贡献规范](./CONTRIBUTING_ZH.md)

## Roadmap

- [Roadmap](./ROADMAP.md)
- [路线图（中文）](./ROADMAP_ZH.md)

## Development

```bash
npm run check
```

MiniCode is intentionally small and pragmatic. The goal is to keep the architecture understandable, hackable, and easy to extend.
