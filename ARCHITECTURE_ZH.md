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

## 当前实现重点：

- 保留“模型 -> 工具 -> 模型”的循环骨架
- 保留统一工具协议和集中注册
- 保留消息驱动的终端交互节奏
- 保留路径权限、命令权限、写入审批这些安全边界
- 保留受 Claude Code 启发的扩展点：本地 skills 和 MCP 动态工具

## 待完成的功能：

- 完整 Ink/React 渲染栈
- bridge / IDE 双向通信
- remote session
- task swarm / sub-agent 编排
- LSP
- skill marketplace
- 复杂 permission 模式
- feature flag 体系
- telemetry / analytics
- compact / memory / session restore（基础 session 持久化和 compact boundary 已实现）



## MiniCode 当前实现

- `src/index.ts`: CLI 入口
- `src/agent-loop.ts`: 多轮工具调用循环
- `src/tool.ts`: 注册、校验、执行
- `src/tools/*`: `list_files` / `grep_files` / `read_file` / `write_file` / `edit_file` / `patch_file` / `modify_file` / `run_command` / `web_fetch` / `web_search` / `ask_user` / `load_skill`
- `src/config.ts`: 使用独立的 `~/.mini-code`
- `src/skills.ts`: 扫描 `.mini-code/skills` 和兼容的 `.claude/skills` 目录
- `src/mcp.ts`: 启动 stdio MCP server，协商兼容的 framing，并把远端 MCP tools 封装成当前工具协议
- `src/background-tasks.ts`: 给 `run_command` 和 TUI 使用的最小 background shell task 注册表
- `src/manage-cli.ts`: 管理持久化 MCP 配置和本地安装的 skills
- `src/anthropic-adapter.ts`: Anthropic 兼容 Messages API 适配器
- `src/utils/token-estimator.ts`: 结构化 token accounting。provider-reported usage 可用时作为主数据源；本地估算只用于缺失 usage 的 fallback，以及最新 provider usage boundary 之后的 tail messages。
- `src/compact/*`: 上下文压缩与自动压缩。auto-compact 使用结构化 accounting total；compact 后会把保留下来的压缩前 provider usage 标记为 stale。
- `src/mock-model.ts`: 离线回退适配器
- `src/permissions.ts`: 路径、命令、编辑审批与 allowlist / denylist
- `src/session.ts`: 多会话持久化，追加写入 JSONL，parentUuid 树结构，compact boundary，会话分叉，过期清理
- `src/file-review.ts`: 写文件前 diff review
- `src/tui/*`: transcript / chrome / input / screen / markdown 终端组件

## 为什么适合学习

MiniCode 的一个优势，是用更轻量的实现方式，提供了类 Claude Code 的功能体验和核心架构思路。

这让它很适合用来：

- 学习 terminal coding agent 的基本组成
- 研究 tool-calling loop
- 理解权限审批和文件 review 流程
- 理解如何在不引入重型插件平台的情况下接入 skills 和 MCP
- 理解一种更接近 Claude Code 的“前台工具执行 / 后台 shell task”区分方式
- 试验终端 UI 的组织方式
- 在小代码量基础上继续做自己的定制开发

## 后续优化方向：

1. 更完整的虚拟滚动 transcript
2. 更完整的输入编辑行为
3. 更细的工具执行状态面板
4. 会话历史与项目记忆（会话持久化已实现；项目记忆仍待开发）
5. 更强的 UI 组件化
