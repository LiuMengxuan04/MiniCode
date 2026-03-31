# MiniCode 架构说明

[English](./ARCHITECTURE.md)

这个文档描述 `mini-code` 的轻量化架构设计决策。
目标不是把终端 agent 做成“大而全”的平台，而是优先保留最有价值的执行闭环、交互体验和安全边界。

## 设计原则

MiniCode 优先保留这些能力：

1. `模型 -> 工具 -> 模型` 的主循环
2. 全屏 TUI 的交互节奏
3. 目录感知、权限审批、危险操作确认
4. transcript / tool / input 的组件化界面结构
5. 用户可 review 的文件修改流程

也就是说，MiniCode 是一个更小、更可控的终端编码助手。

## 先保留什么

第一版只保留最核心的 4 层：

1. CLI 入口层
2. Agent Loop
3. Tool Registry
4. Tool Implementations

当前实现重点：

- 保留“模型 -> 工具 -> 模型”的循环骨架
- 保留统一工具协议和集中注册
- 保留消息驱动的终端交互节奏
- 保留路径权限、命令权限、写入审批这些安全边界

## 第一版明确删掉什么

这些都很强，但不适合一开始就完整带上：

- 完整 Ink/React 渲染栈
- bridge / IDE 双向通信
- remote session
- task swarm / sub-agent 编排
- LSP
- skill marketplace
- 复杂 permission 模式
- feature flag 体系
- telemetry / analytics
- compact / memory / session restore

删掉它们的原因不是“不重要”，而是它们不在最短闭环里。

## 为什么主链路最值得保留

这类工具最有价值的地方，不是功能多，而是这条闭环和交互边界都很清晰：

1. 接收用户输入
2. 送给模型
3. 模型决定是否调用工具
4. 执行工具
5. 把结果回传模型
6. 输出最终答复

如果这条链路稳定了，其它能力都可以挂上去。

## MiniCode 当前实现

- `src/index.ts`: CLI 入口
- `src/agent-loop.ts`: 有最大步数限制的多轮工具调用循环
- `src/tool.ts`: 注册、校验、执行
- `src/tools/*`: `list_files` / `grep_files` / `read_file` / `write_file` / `edit_file` / `patch_file` / `modify_file` / `run_command`
- `src/config.ts`: 使用独立的 `~/.mini-code`
- `src/anthropic-adapter.ts`: Anthropic 兼容 Messages API 适配器
- `src/mock-model.ts`: 离线回退适配器
- `src/permissions.ts`: 路径、命令、编辑审批与 allowlist / denylist
- `src/file-review.ts`: 写文件前 diff review
- `src/tui/*`: transcript / chrome / input / screen / markdown 终端组件

## 为什么适合学习

MiniCode 的一个优势，是用更轻量的实现方式，提供了类 Claude Code 的功能体验和核心架构思路。

这让它很适合用来：

- 学习 terminal coding agent 的基本组成
- 研究 tool-calling loop
- 理解权限审批和文件 review 流程
- 试验终端 UI 的组织方式
- 在小代码量基础上继续做自己的定制开发

## 第二阶段建议

当第一版稳定后，再按顺序加：

1. 更完整的虚拟滚动 transcript
2. 更完整的输入编辑行为
3. 更细的工具执行状态面板
4. 会话历史与项目记忆
5. 更强的 UI 组件化

## 不建议现在做的事

- 一上来就 1:1 复刻全部 Ink 组件
- 一上来就设计完整命令系统之外的所有模式
- 一上来就做多 agent
- 一上来就接 LSP

这些很容易让项目重新变重。

## 我对这个仓库的判断

如果我们目标是做一个“可理解、可扩展、能自己掌控”的 coding agent，小而稳的路径会比一次性复刻大系统更靠谱。
