# Contributing to MiniCode

Thanks for contributing to MiniCode.

MiniCode welcomes pull requests, but the project has a clear scope: it is meant to stay small, readable, and close in spirit to Claude Code's core design direction.

This document explains the baseline expectations for contributions.

## Core Principles

### 1. Keep the project lightweight

Please avoid introducing overly complex design changes.

MiniCode is intentionally small. New contributions should preserve:

- a compact codebase
- direct control flow
- low conceptual overhead
- easy traceability from user action to model loop, tool call, and UI update

Changes that add large abstractions, deep indirection, or framework-heavy rewrites are usually not a good fit unless they are clearly necessary.

### 2. Stay aligned with Claude Code's design direction

Because of the nature of this project, new features should remain close to Claude Code's source-level design direction wherever possible.

That does not mean copying everything mechanically. It means:

- prefer similar architectural ideas over unrelated inventions
- preserve the same mental model when adapting a feature
- avoid introducing product behavior that clearly diverges from the Claude Code style without a strong reason

MiniCode is a lightweight adaptation, not an unrelated terminal agent project.

## Contribution Expectations

### 3. Prefer small, incremental changes

PRs should be easy to review.

Please prefer:

- focused changes over broad refactors
- one feature or one fix per PR
- changes that can be explained clearly in a short PR description

If a feature is large, split it into smaller steps whenever possible.

### 4. Preserve existing interaction patterns

When changing the CLI, TUI, tool loop, permissions, MCP handling, or skills behavior:

- preserve the current user-facing rhythm unless there is a strong reason to change it
- avoid breaking existing commands and workflows
- avoid introducing surprising behavior changes without documenting them

### 5. Keep safety boundaries intact

MiniCode includes important safety boundaries around:

- file modification review
- path access
- command execution
- approval flow

New contributions should not weaken these boundaries casually.

If a change affects safety behavior, explain it clearly in the PR.

### 6. Prefer explicitness over cleverness

This project is also meant to be studied.

Please prefer:

- readable code over clever compactness
- explicit data flow over hidden magic
- simple utilities over premature abstraction

If a design is harder to understand, it should also bring clear value.

### 7. Keep dependencies minimal

Avoid adding new dependencies unless they materially improve the project.

Before adding one, ask:

- can this be done with existing code?
- does the dependency fit the lightweight nature of the project?
- will it make the codebase harder to maintain or understand?

### 8. Update docs when behavior changes

If a PR changes user-facing behavior, please update the relevant documentation.

This may include:

- `README.md`
- `README.zh-CN.md`
- architecture docs
- new command or configuration examples

### 9. Verify before opening a PR

Before opening a PR, please make sure:

- the code builds cleanly
- the relevant behavior has been tested
- `npm run check` passes

If something is intentionally incomplete or unverified, mention it explicitly in the PR description.

### 10. Check issues before starting a feature

For new features, please check the repository issues first.

This helps avoid duplicated work and keeps implementation aligned with the current roadmap.

The preferred flow is:

- check whether an issue already exists
- check whether someone has already claimed the work
- for medium or large features, open an issue first if none exists
- link the PR to the relevant issue whenever possible

Small fixes and minor documentation changes can still go directly to PR when appropriate.

## What Fits Well

Contributions are especially welcome in areas such as:

- interaction polish
- tool loop robustness
- permission and review flow improvements
- MCP compatibility
- skills support
- Claude Code-aligned architectural refinements
- documentation clarity

## What Usually Does Not Fit

These kinds of changes usually need a stronger justification:

- large rewrites that increase architecture complexity significantly
- features that move MiniCode away from Claude Code's design direction
- new layers of abstraction with little practical payoff
- heavy dependency additions for relatively small gains
- behavior changes that make the project harder to study or modify

## PR Notes

A good PR description should briefly explain:

- what changed
- why it is needed
- which issue it is related to, if applicable
- how it stays lightweight
- how it aligns with Claude Code's design direction
- how it was verified

Thanks again for helping improve MiniCode while keeping the project focused.
