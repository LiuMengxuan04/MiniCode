# MiniCode Usage Guide

[Back to README](./README.md) | [简体中文](./USAGE_ZH.md)

This document carries the manual-style content that used to live in the main README: full commands, long-session behavior, configuration, Skills/MCP usage, project layout, and code size. The README now stays focused on the project entry point and high-level overview.

## Table of Contents

- [Feature Details](#feature-details)
- [Installation Details](#installation-details)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Layered Memory and Project Initialization](#layered-memory-and-project-initialization)
- [Long Sessions and Context Management](#long-sessions-and-context-management)
- [Configuration](#configuration)
- [Skills and MCP Usage](#skills-and-mcp-usage)
- [Product Showcase Page](#product-showcase-page)
- [Project Structure](#project-structure)
- [Code Size](#code-size)
- [Development](#development)

## Feature Details

### Core workflow

- multi-step tool execution in a single turn
- `model -> tool -> model` loop
- full-screen terminal interface
- input history, transcript scrolling, and slash command menu
- per-project session persistence with resume, rename, fork, and compact commands
- model-aware context stats with provider usage, estimated tail tokens, auto-compact, context collapse, and snip compact
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
- `update_plan` (root agent only)
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
- oversized tool results are stored on disk with a short in-context preview, keeping long command output from crowding out useful conversation context

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
- large tool results are persisted under MiniCode's local data directory and replaced in the model context by a preview plus file path; repeated passes reuse the same replacement so accounting stays stable
- deterministic snip compact removes safe middle-history messages while protecting file-editing and error turns, keeping recent conversation intact
- context collapse projection layer identifies summarizable spans in long conversations and replaces them with concise summaries to stay within context limits
- Anthropic thinking blocks are now preserved across tool-call turns, maintaining chain-of-thought continuity through multi-step tool execution

## Installation Details

```bash
git clone https://github.com/LiuMengxuan04/MiniCode.git
cd MiniCode
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
- `/plan`
- `/skills`
- `/mcp`
- `/status`
- `/init`
- `/memory`
- `/model`
- `/model <name>`
- `/config-paths`

### Plan / Todo (in-memory MVP)

Ask the agent to keep a checklist for a multi-step task, for example:

```text
Inspect the search implementation and outline its test coverage. Use update_plan to track the steps; do not modify files.
```

`update_plan` replaces the complete Todo list. Existing items carry their returned IDs; new items omit `id`. The same tool can add, rename, remove, reorder, complete, and reopen items. An optional `explanation` describes the adjustment. Statuses are `pending` (`[ ]`), `in_progress` (`[>]`, Active), and `completed` (`[x]`). At most one item may be Active; invalid updates leave the current plan unchanged. An empty list clears the plan, while a fully completed list remains visible.

Use `/plan` to view the list without calling the model. Successful updates also show a checklist in the TUI transcript. The latest plan is added to every root model request, including after context compression; read-only sub-agents cannot update it. A plan does not schedule work, and a normal final response still ends the turn even when Todos remain unfinished.

This first stage keeps only the current session's plan in memory. Restarting, `/new`, `/resume`, or `/fork` starts an empty plan; older tool messages may remain in conversation history but do not restore plan state. `/compact` and context projection keep the live plan. Manual editing commands, selectable Todo controls, and plan persistence are deferred to the next Plan stage.

### Terminal interaction

- command suggestions and slash menu
- transcript scrolling
- prompt editing
- input history navigation
- approval selection and feedback input flow (Up/Down + Enter, or key shortcuts)

### Session management

MiniCode automatically saves your conversation after each turn. Each launch creates a new session with a unique ID.

- `/resume`: open interactive session picker
- `/resume <id>`: resume a specific session by ID
- `/rename <name>`: rename the current session
- `/new`: start a fresh session (previous session is preserved)
- `/fork`: fork the current session into a new independent copy
- `/compact`: compress context to free up context window space

CLI flags:

- `minicode --resume`: launch with session picker
- `minicode --resume <id>`: resume a specific session
- `minicode --fork <id>`: fork a session and resume the fork

Sessions are scoped per working directory and stored in `~/.mini-code/projects/` using append-only JSONL. On exit, MiniCode prints the session ID so you can resume later. Sessions older than 30 days are automatically cleaned up.

## Layered Memory and Project Initialization

MiniCode loads instruction files at startup from a three-layer hierarchy:

1. **User global**: `~/.mini-code/MINI.md` (also reads `~/.mini-code/CLAUDE.md` for compatibility) plus sorted `~/.mini-code/rules/*.md`
2. **Project root and ancestors**: walks upward from cwd, reading `MINI.md`, `MINI.local.md`, `.mini-code/MINI.md`, `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, plus sorted `.mini-code/rules/*.md` at each level
3. **Priority**: content closer to cwd takes precedence over broader layers

Files with identical content are deduplicated. Per-file limit is ~8k chars, total limit ~20k chars. Use `/memory` in the interactive UI to inspect the exact files loaded, their scopes, line counts, and previews.

Instruction files can include other files with a line containing only `@relative/path.md`. Includes are resolved relative to the source file; absolute paths and parent-directory (`..`) escapes are skipped for safety, and cycles are detected.

`/init` scaffolds `.mini-code/`, `.mini-code/rules/`, and `MINI.md` for the current project, and adds generated private rule files to `.gitignore`.

Example `MINI.md`:

```markdown
# Project Rules

- Use TypeScript strict mode.
- Run `npm run check` before committing.
- Keep changes minimal and focused.

@.mini-code/rules/testing.md
```

## Long Sessions and Context Management

MiniCode now treats long-running conversations as a first-class workflow:

- Provider usage, when returned by the model endpoint, is recorded on assistant response boundaries and used as the primary token source.
- If messages are added after the latest provider usage boundary, MiniCode adds a local tail estimate and labels the badge accordingly, for example `usage+est`.
- If no provider usage is available, MiniCode falls back to local estimation so offline mode and compatible gateways still work.
- Context stats feed the TUI badge, warning/blocking levels, and auto-compact trigger.
- `/compact` performs manual context compression using snip compact or context collapse and records a compact boundary in the session log.
- Automatic compaction can summarize or snip older turns once utilization gets high, using either **snip compact** (deterministic middle-history removal that protects edits and errors) or **context collapse** (projection-layer summarization of conversation spans).
- After compaction, retained pre-compact usage is marked stale so an old provider total is not mistaken for the current context size.
- Oversized tool results are written to `~/.mini-code/tool-results/` and replaced in the visible context with a preview and the full-output path. A single result over `50_000` characters is persisted, and batches are reduced toward a `200_000` character visible budget.

Session storage and context compression work together: `loadSession` resumes from the latest compact boundary, while `loadTranscript` can still rebuild the visible transcript from the JSONL event log.

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

## Product Showcase Page

- Open [docs/index.html](./docs/index.html) in a browser for a visual product overview.
- GitHub Pages (recommended): `https://liumengxuan04.github.io/MiniCode/`

## Project Structure

- `src/index.ts`: CLI entry
- `src/agent-loop.ts`: multi-step model/tool loop
- `src/tool.ts`: tool registry and execution
- `src/skills.ts`: local skill discovery and loading
- `src/mcp.ts`: stdio MCP client and dynamic tool wrapping
- `src/manage-cli.ts`: top-level `minicode mcp` / `minicode skills` management commands
- `src/session.ts`: append-only session JSONL, resume/fork/rename, compact boundaries, and expiry cleanup
- `src/compact/*`: manual compact, auto-compact, context collapse projection layer, deterministic snip compact, and conversation summarization helpers
- `src/utils/token-estimator.ts`: provider-usage-first context accounting with estimate fallback
- `src/utils/tool-result-storage.ts`: large tool-output persistence and preview replacement
- `src/tools/*`: built-in tools
- `src/tui/*`: terminal UI modules
- `src/config.ts`: runtime configuration loading
- `src/install.ts`: interactive installer

## Code Size

Current core implementation size is about **7,874 lines**.

Counting scope:

- included: core TypeScript source, built-in tools, config, MCP, sessions, compaction, adapters, permissions, and `bin/minicode`
- excluded: docs, tests, `external/`, `node_modules/`, and TUI files (`src/tui/`, `src/tty-app.ts`, `src/ui.ts`)

If `src/tty-app.ts` and `src/ui.ts` are included while still excluding `src/tui/`, the total is about **9,767 lines**.

## Development

```bash
npm run check
npm test
```

MiniCode is intentionally small and pragmatic. The goal is to keep the architecture understandable, hackable, and easy to extend.

## Goal: continue across turns

Use `/goal <description>` to create and start one in-memory Goal. `/goal` or `/goal status` shows the objective, completion criteria, status, and shared Plan. The agent first updates a nonempty Plan and sets criteria with `update_goal`. Ordinary final answers end one turn; an active Goal continues in another turn.

- `/goal pause [reason]` stops automatic execution, including during a model request or approval. Already-started tools settle and their results are retained; remaining calls in the batch are cancelled.
- `/goal resume` explicitly resumes a paused or blocked Goal. If `ask_user` is waiting, answer it first. Answering while paused records the answer and leaves the Goal paused.
- `/goal clear` stops and removes the Goal while retaining the Plan and workspace changes. Clear an existing Goal before creating another.
- The agent uses `get_goal` and `update_goal` only in Goal turns. It cannot create a Goal, change its original description, or resume itself.
- Completion requires a prepared nonempty Plan with every Todo completed, nonempty criteria, a summary, and one check explanation per criterion. This MVP validates structure, not references to tool evidence. Completed/blocked updates stop the rest of the tool batch immediately.

Each Goal turn is limited to 50 model/tool steps. Three consecutive automatic turns without tool calls pause the Goal. Model errors, unhandled tool errors, and session-save failures also stop automatic execution. The existing file and command approval rules still apply.

Goal and Plan state are process-local. TUI `/new`, `/resume`, and `/fork` stop execution and clear Goal state; a restarted process never resumes automatically. Non-TTY input also accepts Goal commands, but cannot approve interactive operations; EOF stops execution. Goal updates, persistence, stronger evidence checks, and richer UI are follow-up work.

## Loop: repeat a prompt

`/loop [Nm|Nh] <prompt>` creates one process-local recurring prompt; for example, `/loop 5m Review the test output and report any changes`. Omit the interval for 10 minutes. Intervals must be at least 1 minute and fit a JavaScript timer. `/loop` displays the task; `/loop stop` stops and removes it, retaining the Plan.

The first run starts when the session is idle. Each successful final is followed by a full interval measured from completion, including tool and message-save settlement. If another turn or local command is busy when the timer fires, Loop keeps one pending trigger and runs once after it becomes idle. It never accumulates missed runs. Ordinary chat can run between triggers.

Loop uses the same agent runner and optional Plan, with at most 50 steps per turn. It has no Goal context or Goal tools. An active, running, stopping, or waiting Goal/Loop blocks the other mode; pause/clear the Goal or stop the Loop before switching. An unanswered Goal question must be answered or cleared first.

`ask_user` suspends scheduling until a real answer arrives. Approvals continue to use the existing UI; `/loop stop` also works during approval. Errors or the step limit leave Loop paused. This MVP has no pause/resume commands or `stop_loop` tool: inspect `/loop`, then stop and recreate as needed.

TUI session switches and process exit cancel timers and active runs. State is not restored after restart. Explicit background shell commands remain governed by existing behavior; stopping Loop does not undo workspace changes or terminate previously detached commands. No cron expressions, daemon, multiple tasks, or catch-up queue are provided.
