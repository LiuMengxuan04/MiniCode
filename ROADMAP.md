# MiniCode Roadmap

MiniCode already has a usable lightweight terminal coding workflow, but there is still a visible gap between the current `main` branch and a more complete Claude Code-like runtime.

This roadmap highlights the most valuable missing capabilities and the order in which they should ideally be improved.

Pull requests are welcome, especially when they align with the contribution guidelines and keep the project lightweight.

## P0

### 1. Model-aware context management

**Status: mostly implemented; follow-up polish remains.**

This is the most important missing runtime capability.

It includes:

- model-aware context window configuration
- provider-reported usage accounting as the primary token source
- context usage display in the TUI, including whether the value is provider usage, usage plus estimated tail, or estimate-only fallback
- automatic context compaction for long conversations, triggered from structured accounting totals instead of a bare local estimate

MiniCode now records provider usage on assistant response boundaries and computes context stats from a structured accounting result. The local estimator remains available for providers that do not return usage, offline tests, and tail messages appended after the latest provider usage boundary. Compaction marks retained pre-compact usage stale so the next context calculation does not treat an old response's usage as the current conversation total.

This work matters because long-session stability depends on it. It is also one of the most important design areas where MiniCode still trails a more complete Claude Code-style runtime.

### 2. API retry and backoff

**Status: implemented.** The main Anthropic adapter retries on 429 and 5xx with exponential backoff and honors `Retry-After` when present. The companion [Python](./external/MiniCode-Python/) and [Rust](./external/MiniCode-rs/) ports follow the same behavior.

Possible follow-ups include a more uniform configurable retry policy, richer observability, or applying the same policy consistently across additional provider code paths.

### 3. Session persistence and resume

**Status: implemented.** Sessions are saved per working directory in `~/.mini-code/projects/` using append-only JSONL with parentUuid tree structure. Includes `/resume`, `/rename`, `/new`, `/fork`, `/compact` commands, interactive session picker with delete support, `--resume`/`--fork` CLI flags, and automatic 30-day expiry cleanup.

### 4. Multi-language implementation branches

**Status: Python and Rust companion implementations are available; Go remains exploratory.**

Another important direction is to explore parallel implementations of MiniCode in other languages, especially:

- Python (companion repo available)
- Go (no formal companion implementation yet)
- Rust (companion repo available)

This is particularly valuable for the learning side of the project.

The goal is not to fragment the main codebase immediately. The goal is to encourage language-specific branches or companion implementations that preserve the same core ideas:

- lightweight architecture
- Claude Code-aligned design direction
- readable agent loop and tool model
- educational value for contributors studying different ecosystems

If you are interested in maintaining or extending the Python or Rust variants, or starting a Go direction, contributions and direct collaboration are welcome.

## P1

### 5. Layered memory loading

MiniCode should support a lightweight memory hierarchy similar in spirit to Claude Code's layered project context.

This may include:

- global memory
- project memory
- nested/project-local memory
- simple include support where appropriate

### 6. Stronger provider abstraction

MiniCode currently works well with Anthropic-style APIs and some compatible providers, but the provider model can be made more explicit and complete.

Target direction:

- Anthropic
- OpenAI-compatible endpoints
- OpenRouter
- LiteLLM-style gateways

### 7. Todo or task tracking support

A lightweight built-in task tracker would improve long multi-step execution.

This should stay simple and should not become a heavyweight planning subsystem.

### 8. `.claude/agents` and sub-agent support

This is an important capability, but it also adds complexity.

It is worth doing after the core runtime is more stable.

### 9. Expand the core toolset selectively

MiniCode does not need to chase Claude Code's full tool count mechanically, but it does need to expand beyond the current minimal set over time.

The direction here should be:

- add tools that support core runtime capabilities
- prefer Claude Code-aligned tool patterns over unrelated inventions
- keep the built-in set small and high-value
- continue to rely on MCP for many external or optional capabilities

Priority should go to missing core tool categories such as:

- session and memory related capabilities
- context management related capabilities
- lightweight task tracking
- a few high-value built-in tools where MCP is not a sufficient substitute

The goal is not tool-count parity. The goal is a stronger core toolset while preserving MiniCode's lightweight identity.

## P2

### 9. Notebook editing support

Useful, but not essential for the main terminal coding workflow.

### 10. Built-in web tools

MiniCode can already extend itself through MCP, so built-in `WebFetch` / `WebSearch` are useful but not the most urgent gap.

### 11. Evaluation and trace infrastructure

This includes:

- benchmark harnesses
- structured trace capture
- reproducible agent evaluation

This is valuable for research and comparison, but it is not on the critical path for the main product loop.

### 12. Prompt caching

Worth exploring later, especially once context accounting and provider integration are more mature.

## Contribution Notes

If you want to contribute in these areas:

- prefer focused PRs
- keep the implementation lightweight
- align the design with Claude Code's direction where possible
- explain how the change was validated

See:

- [Contribution Guidelines](./CONTRIBUTING.md)
- [中文贡献规范](./CONTRIBUTING_ZH.md)
