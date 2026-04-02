# MiniCode 路线图

MiniCode 当前已经具备一个可用的轻量终端 coding workflow，但和一个更完整的类 Claude Code runtime 相比，`main` 分支仍然存在一些明显缺口。

这份路线图用于整理最有价值的缺失能力，以及它们更适合推进的优先级顺序。

也欢迎围绕这些方向提交 PR，前提是遵守贡献规范，并尽量保持项目轻量。

## P0

### 1. 模型感知的上下文管理

这是当前最重要的运行时缺口。

包括：

- 模型感知的 `context window` 配置
- 基于供应商返回 usage 的 token 记账
- TUI 中的上下文占用显示
- 长会话中的自动上下文压缩

这部分直接决定长会话是否稳定，也是 MiniCode 当前和更完整 Claude Code 风格 runtime 差距最大的部分之一。

### 2. API retry 与 backoff

MiniCode 需要更稳地处理模型供应商侧的临时失败。

包括：

- 对 429 和 5xx 的重试
- exponential backoff
- 在可用时尊重 `Retry-After`

如果缺少这层能力，供应商侧抖动会过于直接地影响主交互闭环。

### 3. 会话持久化与恢复

MiniCode 应该支持更可靠的 session save / resume。

包括：

- 自动保存
- 手动恢复
- 基础的会话恢复能力

这对真实使用和长任务执行都很重要。

## P1

### 4. 分层 memory 加载

MiniCode 应该支持一种轻量的分层 memory 体系，方向上接近 Claude Code 的 layered project context。

可以包括：

- 全局 memory
- 项目级 memory
- 嵌套目录 / 本地 memory
- 在合适范围内支持简单 include

### 5. 更完整的 provider abstraction

MiniCode 当前已经能接 Anthropic 风格接口和部分兼容供应商，但 provider 模型还可以更明确、更完整。

目标方向：

- Anthropic
- OpenAI-compatible endpoints
- OpenRouter
- LiteLLM-style gateways

### 6. Todo / task tracking

一个轻量内置任务跟踪工具会明显提升多步执行体验。

但它应该保持轻量，不要演变成很重的 planning subsystem。

### 7. `.claude/agents` 与 sub-agent 支持

这是一个重要能力，但复杂度也会明显上升。

更适合在核心 runtime 更稳定之后推进。

### 8. 有选择地扩充核心工具集

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
