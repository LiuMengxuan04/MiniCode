# MiniCode 路线图

MiniCode 当前已经具备一个可用的轻量终端 coding workflow，但和一个更完整的类 Claude Code runtime 相比，`main` 分支仍然存在一些明显缺口。

这份路线图用于整理最有价值的缺失能力，以及它们更适合推进的优先级顺序。

也欢迎围绕这些方向提交 PR，前提是遵守贡献规范，并尽量保持项目轻量。

## P0

### 1. 模型感知的上下文管理

**状态：进行中。**

这是当前最重要的运行时缺口。

包括：

- 模型感知的 `context window` 配置
- 基于供应商返回 usage 的 token 记账
- TUI 中的上下文占用显示
- 长会话中的自动上下文压缩

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

MiniCode 应该支持一种轻量的分层 memory 体系，方向上接近 Claude Code 的 layered project context。

可以包括：

- 全局 memory
- 项目级 memory
- 嵌套目录 / 本地 memory
- 在合适范围内支持简单 include

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

### 9. Notebook 编辑支持

有价值，但不是当前 terminal coding workflow 的最核心缺口。

### 10. 内置 web 工具

MiniCode 现在已经可以通过 MCP 自我扩展，所以内置 `WebFetch` / `WebSearch` 有帮助，但不是最紧急的能力缺口。

### 11. 评测与 trace 基建

包括：

- benchmark harness
- 结构化 trace 捕获
- 可复现 agent evaluation

这对研究和比较非常有价值，但不属于主产品闭环的第一优先级。

### 12. Prompt caching

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
