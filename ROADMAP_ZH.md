# MiniCode 路线图

MiniCode 当前已经具备一个可用的轻量终端 coding workflow，但和一个更完整的类 Claude Code runtime 相比，`main` 分支仍然存在一些明显缺口。

这份路线图用于整理最有价值的缺失能力，以及它们更适合推进的优先级顺序。

也欢迎围绕这些方向提交 PR，前提是遵守贡献规范，并尽量保持项目轻量。

## P0

### 1. 模型感知的上下文管理

**状态：主体已实现，仍可继续 polish。**

这是当前最重要的运行时缺口。

包括：

- 模型感知的 `context window` 配置
- 以供应商返回 usage 为主要来源的 token 记账
- TUI 中的上下文占用显示，并区分 provider usage、usage + estimated tail、estimate-only fallback
- 长会话中的自动上下文压缩，触发依据来自结构化 accounting total，而不是裸本地估算值
- 大工具结果替换：超大输出会持久化到磁盘，模型可见上下文里只保留预览和完整路径

MiniCode 现在会把 provider usage 记录在 assistant response boundary 上，并用结构化 accounting result 计算 context stats。本地 estimator 仍保留给不返回 usage 的 provider、离线测试，以及最新 provider usage boundary 之后追加的 tail messages。压缩会话时，保留下来的压缩前 usage 会被标记为 stale，避免后续把旧 response usage 当作当前上下文真实值。超大工具输出会写入 MiniCode 本地数据目录，并替换成稳定的预览消息，避免长命令输出主导上下文记账。

这部分直接决定长会话是否稳定，也是 MiniCode 当前和更完整 Claude Code 风格 runtime 差距最大的部分之一。

### 2. API retry 与 backoff

**状态：已实现。** 主仓库 Anthropic 适配层已对 429、5xx 做有限次重试，采用指数退避并在可用时尊重 `Retry-After`；伴生的 [Python](./external/MiniCode-Python/) 与 [Rust](./external/MiniCode-rs/) 实现与上述行为对齐。

若后续要增强，可考虑统一可配置的重试策略、更细粒度的可观测性，或在其他 provider 路径上复用同一套策略。

### 3. 会话持久化与恢复

**状态：已实现。** 会话按工作目录隔离存储在 `~/.mini-code/projects/`，采用追加写入的 JSONL 格式，支持 parentUuid 树结构。包括 `/resume`、`/rename`、`/new`、`/fork`、`/compact` 命令，交互式会话选择器（支持删除），`--resume`/`--fork` CLI 参数，以及 30 天自动过期清理。

### 4. 多语言实现分支

**状态：Python 与 Rust 伴生实现已就绪；Go 仍为探索方向。**

另一个重要方向，是探索 MiniCode 的多语言实现版本，尤其包括：

- Python（已有伴生仓库）
- Go（尚未有正式伴生实现）
- Rust（已有伴生仓库）

这对项目的“学习价值”很重要。

目标并不是立刻把主代码库拆散，而是鼓励围绕同一套核心思路，逐步发展语言对应的分支或伴生实现：

- 保持轻量架构
- 与 Claude Code 的设计方向保持趋同
- 保持 agent loop 和 tool model 的可读性
- 让不同语言生态中的学习者也能从中受益

如果你对维护或扩展 Python、Rust 版本，或启动 Go 方向，也非常欢迎直接联系并参与贡献。

## P1

### 5. 分层 memory 加载

**状态：已实现。** MiniCode 现在从三层层级加载指令文件：用户全局（`~/.mini-code/MINI.md`）、项目根、嵌套目录（从 cwd 向上递归）。支持 `MINI.md`、`MINI.local.md`、`.mini-code/MINI.md`、`.mini-code/rules/*.md`，并兼容扫描 `CLAUDE.md` 和 `.claude/CLAUDE.md`。包含内容去重、`@path` include 解析、`/memory` 检查命令和容量限制。

`/init` 命令可初始化项目：创建 `.mini-code/`、向 `.gitignore` 追加 MiniCode 条目、根据项目检测生成 `MINI.md` 模板（语言、框架、验证命令、目录结构）。幂等 — 可安全重复运行。

后续计划：

- auto memory read/write

### 6. 更完整的 provider abstraction

MiniCode 当前已经能接 Anthropic 风格接口和部分兼容供应商，但 provider 模型还可以更明确、更完整。

目标方向：

- Anthropic
- OpenAI-compatible endpoints
- OpenRouter
- LiteLLM-style gateways

### 7. Todo / task tracking

一个轻量内置任务跟踪工具会明显提升多步执行体验。

但它应该保持轻量，不要演变成很重的 planning subsystem。

### 8. `.claude/agents` 与 sub-agent 支持

这是一个重要能力，但复杂度也会明显上升。

更适合在核心 runtime 更稳定之后推进。

### 9. 有选择地扩充核心工具集

MiniCode 不需要机械追求和 Claude Code 一样的工具数量，但随着项目演进，当前这套最小工具集确实需要继续扩充。

这里更合适的方向是：

- 优先补足支撑核心 runtime 能力的工具
- 优先借鉴与 Claude Code 趋同的工具模式，而不是发明完全无关的新工具体系
- 保持内置工具集“小而硬”
- 继续把很多外部或可选能力交给 MCP 承担

优先考虑的工具类别包括：

- session / memory 相关能力
- context management 相关能力
- 轻量任务跟踪能力
- 少量 MCP 无法很好替代的高价值内置工具

目标不是和 Claude Code 做工具数量对齐，而是在保持 MiniCode 轻量定位的前提下，逐步补强核心工具能力。

## P2

### 10. Notebook 编辑支持

有价值，但不是当前 terminal coding workflow 的最核心缺口。

### 11. 内置 web 工具

MiniCode 现在已经可以通过 MCP 自我扩展，所以内置 `WebFetch` / `WebSearch` 有帮助，但不是最紧急的能力缺口。

### 12. 评测与 trace 基建

包括：

- benchmark harness
- 结构化 trace 捕获
- 可复现 agent evaluation

这对研究和比较非常有价值，但不属于主产品闭环的第一优先级。

### 13. Prompt caching

值得后续探索，尤其是在 context accounting 和 provider integration 更成熟之后。

## 贡献说明

如果你希望围绕这些方向提交 PR，请尽量：

- 优先做聚焦型 PR
- 保持实现轻量
- 尽量与 Claude Code 的设计方向保持一致
- 在 PR 中说明验证方式

参见：

- [中文贡献规范](./CONTRIBUTING_ZH.md)
- [Contribution Guidelines](./CONTRIBUTING.md)
