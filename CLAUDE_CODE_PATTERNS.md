# What Claude Code Design Ideas You Can Learn Through MiniCode

## 1. Agent Loop

### Claude Code design

Claude Code is centered on an agent loop:

- receive user input
- assemble context
- call the model
- decide whether tools are needed
- execute tools
- feed results back into the model
- stop only when the current turn can actually end

### What MiniCode makes visible

MiniCode follows the same direction. The project is organized around a multi-step turn loop. The UI, tool layer, permissions, MCP, and skills are all shaped around that execution flow.

## 2. Structured Message Model

### Claude Code design

Claude Code does not treat the session as plain chat text. It distinguishes between different types of state in the conversation, such as:

- user input
- final assistant output
- intermediate progress
- tool calls
- tool results
- compaction boundaries or summaries

### What MiniCode makes visible

MiniCode also moved away from a plain transcript model. It now distinguishes between normal assistant output, progress, tool calls, tool results, and compacted context summaries.

## 3. Tool Use as a Protocol

### Claude Code design

In Claude Code, tool use is a protocol:

- the model declares tool intent
- the system validates tool input
- permissions participate in the decision
- tool execution returns normalized results
- results are fed back into the next reasoning step

### What MiniCode makes visible

MiniCode uses the same structure. Tools are registered through one system, validated through schemas, executed through one entry point, and returned in a consistent format. Local tools and MCP-backed tools are both brought into the same execution model.

## 4. Progress and Final Are Different States

### Claude Code design

Claude Code separates “still working” from “finished.” A process update is not treated as a final answer just because it is natural-language text.

### What MiniCode makes visible

MiniCode follows the same distinction. Intermediate execution text is treated as progress, rendered separately, and handled differently from final assistant output.

## 5. Permissions Belong Inside the Execution Path

### Claude Code design

Claude Code treats permissions as part of the execution model itself. Risky operations such as command execution or file modification sit behind approval and review boundaries that are part of the system’s normal control flow.

### What MiniCode makes visible

MiniCode follows the same architectural choice. Command approval, review before writes, per-turn permission memory, and rejection feedback are all inside the turn loop.

## 6. MCP as Dynamic Capability Injection

### Claude Code design

The important idea behind MCP is that external servers can dynamically expose capabilities into the current agent session.

### What MiniCode makes visible

MiniCode takes the same approach. It reads MCP configuration, connects to external servers, discovers remote tools, and mounts them into the local tool surface. Resources and prompts are also exposed through a shared helper layer.

## 7. Skills as Lightweight Workflow Extension

### Claude Code design

Claude Code skills act more like lightweight workflow extensions:

- task-specific instructions
- domain-specific execution constraints
- reusable working patterns that can be loaded when needed

### What MiniCode makes visible

MiniCode applies the same idea in a smaller form. Local `SKILL.md` files can be discovered and loaded into the execution flow, allowing the model to adopt a more specific workflow.

## 8. Automatic Context Compaction

### Claude Code design

Claude Code does not treat long-context management as simple deletion. Older context is compressed into a form that still supports continued work, while newer context remains available in higher fidelity. Context decisions also need to be tied to the real model budget instead of a vague sense that the conversation "feels long."

### What MiniCode makes visible

MiniCode follows the same direction. When conversation state becomes too large, earlier messages can be summarized into a `context_summary`, and the recent tail is preserved. Two complementary auto-compact strategies are available: **snip compact** (deterministic middle-history removal that protects file edits and errors) and **context collapse** (projection-layer summarization of conversation spans). Auto-compact is driven by structured context stats rather than a blind message count.

## 9. Provider Usage as Context Truth

### Claude Code design

A production coding agent should not rely only on local token guesses when the provider can return usage metadata. Provider usage is the closest available truth for current context size, while local estimation is still useful as a fallback or for messages added after the latest provider boundary.

### What MiniCode makes visible

MiniCode records provider usage on assistant response boundaries and uses it as the primary source for context accounting. If new messages are appended after that boundary, MiniCode adds an estimated tail and marks the source accordingly, for example `usage+est`. If usage becomes stale after compaction, it is explicitly marked stale so old provider totals are not reused as current context truth.

This makes the TUI context badge, warning levels, blocking levels, and auto-compact trigger all depend on the same accounting result.

## 10. Session Events, Resume, and Forking

### Claude Code design

Long-running coding agents need more than an in-memory chat buffer. They need a durable session model that can survive process exits, support resuming work, and preserve enough structure to understand how the conversation evolved.

### What MiniCode makes visible

MiniCode stores sessions per working directory as append-only JSONL events. Each event has metadata such as session ID, timestamp, cwd, and parent linkage. The runtime can resume a session, rename it, start a fresh one, fork an existing session into an independent branch, and clean up expired sessions.

Compact boundaries are also stored as events. When a session is resumed, MiniCode can load from the latest compact boundary while still keeping the full transcript reconstructable from the event log.

## 11. Large Tool Results Should Leave the Prompt

### Claude Code design

Tool results can be much larger than the useful signal they contain. A coding agent has to protect the model context from being dominated by huge command output, generated files, logs, or search results. The important design idea is to separate "available to the system" from "fully inserted into the prompt."

### What MiniCode makes visible

MiniCode persists oversized tool results under its local data directory and replaces the model-visible content with a short preview plus the full-output file path. Single huge results and oversized batches are reduced before they enter the next model step.

That keeps the full data available for inspection while preventing tool output from crowding out the conversation, recent edits, and task intent.

## 12. TUI as a State-Machine View

### Claude Code design

Claude Code’s terminal UI acts as a visualization of internal system state:

- tool running vs success vs failure
- progress vs final response
- approval pending vs normal execution
- compacted or summarized output where appropriate

### What MiniCode makes visible

MiniCode’s TUI follows the same direction. It renders running tool states, progress messages, approval states, and collapsed tool summaries.

## 13. Foreground Tool Execution and Background Shell Tasks Are Different

### Claude Code design

Claude Code does not treat every command as the same kind of synchronous tool call. Long-running shell commands that can outlive the current turn are modeled as separate tasks rather than being left hanging as ordinary unfinished tool executions.

### What MiniCode makes visible

MiniCode now follows that direction in a lightweight form. Explicitly backgrounded shell commands are no longer treated as ordinary synchronous `run_command` executions. They are registered as minimal background shell tasks and surfaced separately in the TUI. This is not a full clone of Claude Code’s task system, but it does preserve the design idea that foreground tool execution and background shell tasks should be modeled differently.

## 14. Boundary Between Borrowing and Simplification

### Claude Code design

Claude Code is a full product-scale system. Many of its design choices sit on top of larger state management, context handling, and interaction layers.

### What MiniCode makes visible

MiniCode keeps the structural ideas rather than the full production footprint. What it keeps are the parts that shape the system most strongly:

- loop-first architecture
- structured message handling
- unified tool protocol
- permission-aware execution
- MCP as dynamic extension
- skills as workflow extension
- usage-aware context accounting and automatic compaction
- durable sessions, resume, and fork
- large tool-result storage outside the prompt
- state-oriented terminal UI
- a distinction between foreground tool execution and background shell tasks

MiniCode is better understood as a small Claude Code-style reference implementation rather than as a full clone.
