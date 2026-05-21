# MiniCode

<p align="center">
  <img src="./docs/logo.svg" alt="MiniCode Logo" width="180" />
</p>

<h2 align="center">MiniCode</h2>

<p align="center">
  <img src="https://img.shields.io/badge/Editor-Minicode-D97757?style=for-the-badge" alt="Editor: Minicode" />
  <img src="https://img.shields.io/badge/%23minicode-Project-B85C3F?style=for-the-badge" alt="#minicode" />
  <img src="https://img.shields.io/badge/%23lightweight-Focus-F0EBE1?style=for-the-badge&labelColor=8B8B8B" alt="#lightweight" />
  <a href="https://deepwiki.com/LiuMengxuan04/MiniCode">
    <img src="https://img.shields.io/badge/Ask-DeepWiki-0F7BBF?style=for-the-badge&labelColor=2B2B2B" alt="Ask DeepWiki" />
  </a>
</p>

---

<p align="center">
  A lightweight, highly efficient coding tool. Designed for speed, built for simplicity.
</p>

[简体中文](./README.zh-CN.md) | [Usage Guide](./USAGE.md) | [DeepWiki](https://deepwiki.com/LiuMengxuan04/MiniCode) | [Architecture](./ARCHITECTURE.md) | [Contributing](./CONTRIBUTING.md) | [Roadmap](./ROADMAP.md) | [License](./LICENSE)

MiniCode is a lightweight terminal coding assistant for local development workflows.

It provides Claude Code-like workflow and architectural ideas in a much smaller implementation, making it especially useful for learning, experimentation, and custom tooling.

## Overview

MiniCode is built around a practical terminal-first agent loop:

- accept a user request
- inspect the workspace
- call tools when needed
- review file changes before writing
- return a final response in the same terminal session

The project is intentionally compact, so the control flow, tool model, and TUI behavior remain easy to understand and extend.

## Core Authors

<table>
  <tr>
    <td align="center" valign="top" width="20%">
      <a href="https://github.com/LiuMengxuan04">
        <img src="https://github.com/LiuMengxuan04.png?size=160" width="96" height="96" alt="LiuMengxuan04" /><br />
        <strong>Liu Mengxuan</strong>
      </a>
      <br />
      <sub><strong>Founder</strong></sub>
      <br />
      <sub>Leads the TypeScript repo, core workflow, MCP/Skills, TUI, and docs.</sub>
    </td>
    <td align="center" valign="top" width="20%">
      <a href="https://github.com/GateJustice">
        <img src="https://github.com/GateJustice.png?size=160" width="96" height="96" alt="GateJustice" /><br />
        <strong>GateJustice</strong>
      </a>
      <br />
      <sub><strong>Co-initiator</strong></sub>
      <br />
      <sub>Contributes the long-session context system, including usage accounting, auto compact, and context collapse.</sub>
    </td>
    <td align="center" valign="top" width="20%">
      <a href="https://github.com/harkerhand">
        <img src="https://github.com/harkerhand.png?size=160" width="96" height="96" alt="harkerhand" /><br />
        <strong>harkerhand</strong>
      </a>
      <br />
      <sub><strong>MiniCode-rs</strong></sub>
      <br />
      <sub>Main author of the Rust version.</sub>
    </td>
    <td align="center" valign="top" width="20%">
      <a href="https://github.com/QUSETIONS">
        <img src="https://github.com/QUSETIONS.png?size=160" width="96" height="96" alt="QUSETIONS" /><br />
        <strong>QUSETIONS</strong>
      </a>
      <br />
      <sub><strong>MiniCode-Python</strong></sub>
      <br />
      <sub>Main author of the Python version.</sub>
    </td>
    <td align="center" valign="top" width="20%">
      <a href="https://github.com/GoDiao">
        <img src="https://github.com/GoDiao.png?size=160" width="96" height="96" alt="GoDiao" /><br />
        <strong>GoDiao</strong>
      </a>
      <br />
      <sub><strong>Core contributor</strong></sub>
      <br />
      <sub>Contributes layered memory, /init, session resume, and TUI interaction improvements.</sub>
    </td>
  </tr>
</table>

Summaries are based on the main repository and multi-language branch commit history. For the broader contributor list, please refer to the repository commit history.

## Multi-language Versions

- TypeScript (this repo): [MiniCode](https://github.com/LiuMengxuan04/MiniCode)
- Rust version: [MiniCode-rs](https://github.com/harkerhand/MiniCode-rs/tree/master)
- Python version: [MiniCode-Python](https://github.com/QUSETIONS/MiniCode-Python)
- Java version: [MiniCode4j](https://github.com/hobbescalvin414-tech/minicode4j/tree/feat/default-ts-ui)

## Product Showcase Page

- Open [docs/index.html](./docs/index.html) in a browser for a visual product overview.
- GitHub Pages (recommended): `https://liumengxuan04.github.io/MiniCode/`

## Why MiniCode

MiniCode is a good fit if you want:

- a lightweight coding assistant instead of a large platform
- a terminal UI with tool calling, transcript, and command workflow
- a small codebase that is suitable for study and modification
- a reference implementation for Claude Code-like agent architecture

## Core Capabilities

- Multi-step tool execution in a single turn, forming a `model -> tool -> model` loop.
- Full-screen terminal UI with input history, transcript scrolling, slash command menu, and approval flows.
- Per-project session persistence with resume, rename, fork, and compact commands.
- Provider-usage-first context stats with tail estimates, auto-compact, context collapse, and snip compact.
- Built-in tools for files, search, editing, command execution, web fetch/search, and clarification prompts.
- Local skills discovered through `SKILL.md`, plus MCP tools/resources/prompts over stdio or remote HTTP.
- Review-before-write file edits with path and command permission checks.
- Oversized tool results are stored on disk and replaced in context with a short preview and file path.

Full command references, configuration examples, session details, and Skills/MCP usage have moved to the [Usage Guide](./USAGE.md).

## Installation

```bash
cd mini-code
npm install
npm run install-local
```

The installer asks for the model name, `ANTHROPIC_BASE_URL`, and `ANTHROPIC_AUTH_TOKEN`. Configuration is stored in:

- `~/.mini-code/settings.json`
- `~/.mini-code/mcp.json`

You can override the config directory with `MINI_CODE_HOME` and the launcher directory with `MINI_CODE_BIN_DIR`. See [Installation Details](./USAGE.md#installation-details) for more.

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

## Common Entry Points

- `/help`: show interactive help.
- `/tools`: list available tools.
- `/skills`: list discovered skills.
- `/mcp`: show MCP connection status.
- `/status`: show session and context status.
- `/init`: scaffold `.mini-code/` and `MINI.md` for the current project.
- `/memory`: inspect the layered memory files loaded for the current turn.
- `/model` / `/model <name>`: inspect or switch the model.
- `/resume`: open the session picker.
- `/compact`: manually compact the context.

Management commands include `minicode mcp ...` and `minicode skills ...`. See [Commands](./USAGE.md#commands) for the full reference.

## Documentation

- [Usage Guide](./USAGE.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [中文架构说明](./ARCHITECTURE_ZH.md)
- [Contribution Guidelines](./CONTRIBUTING.md)
- [中文贡献规范](./CONTRIBUTING_ZH.md)
- [Roadmap](./ROADMAP.md)
- [路线图](./ROADMAP_ZH.md)
- [Learn Claude Code Design Through MiniCode](./CLAUDE_CODE_PATTERNS.md)

## Star History

<a href="https://www.star-history.com/?repos=LiuMengxuan04%2FMiniCode&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=LiuMengxuan04/MiniCode&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=LiuMengxuan04/MiniCode&type=date&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=LiuMengxuan04/MiniCode&type=date&legend=bottom-right" />
 </picture>
</a>

## Development

```bash
npm run check
npm test
```

MiniCode is intentionally small and pragmatic. The goal is to keep the architecture understandable, hackable, and easy to extend.
