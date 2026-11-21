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
- 通过追加写入的会话历史、compact boundary、provider usage 上下文记账、大工具输出替换、确定性裁剪压缩和上下文折叠投影，让长时间会话保持可用

## 待完成的功能：

- 完整 Ink/React 渲染栈
- bridge / IDE 双向通信
- remote session
- 持久化 agent 定义、嵌套 agent 与更复杂的 task swarm 编排（最小 sub-agent runtime 已实现）
- LSP
- skill marketplace
- 复杂 permission 模式
- feature flag 体系
- telemetry / analytics
- 分层项目 memory 与更完整的会话搜索（基础分层 memory 加载已实现）



## MiniCode 当前实现

- `src/index.ts`: CLI 入口
- `src/agent-loop.ts`: 多轮工具调用循环
- `src/trace.ts`: 隐私安全的结构化运行事件与 JSONL 持久化
- `src/eval.ts`: 在真实 agent loop 上执行确定性模型/工具 replay
- `src/agents/manager.ts`: 内存态 sub-agent 生命周期、并发上限、等待与取消
- `src/agents/worker-prompt.ts`: 只读 worker 的最小系统提示词
- `src/tools/sub-agents.ts`: root agent 使用的 `spawn_agent` / `list_agents` / `wait_agent` / `close_agent`
- `src/tool.ts`: 注册、校验、执行
- `src/tools/*`: `list_files` / `grep_files` / `read_file` / `write_file` / `edit_file` / `patch_file` / `modify_file` / `run_command` / `web_fetch` / `web_search` / `ask_user` / `load_skill`
- `src/config.ts`: 使用独立的 `~/.mini-code`
- `src/skills.ts`: 扫描 `.mini-code/skills` 和兼容的 `.claude/skills` 目录
- `src/mcp.ts`: 启动 stdio MCP server，协商兼容的 framing，并把远端 MCP tools 封装成当前工具协议
- `src/background-tasks.ts`: 给 `run_command` 和 TUI 使用的最小 background shell task 注册表
- `src/manage-cli.ts`: 管理 MCP 配置、本地 skills 和 replay eval 执行
- `src/anthropic-adapter.ts`: Anthropic 兼容 Messages API 适配器，支持跨工具调用轮次保留 thinking block
- `src/utils/token-estimator.ts`: 结构化 token accounting。provider-reported usage 可用时作为主数据源；本地估算只用于缺失 usage 的 fallback，以及最新 provider usage boundary 之后的 tail messages。
- `src/utils/tool-result-storage.ts`: 将超大工具结果持久化到 MiniCode 本地数据目录，并在可见上下文里替换成预览和文件路径；同一次运行中会复用稳定替换结果。
- `src/compact/*`: 上下文压缩与自动压缩。包括上下文折叠投影层（可摘要片段识别与替换）、确定性裁剪压缩（安全移除中段历史，保护编辑和出错轮次），以及结构化 accounting 集成。auto-compact 使用结构化 accounting total；compact 后会把保留下来的压缩前 provider usage 标记为 stale。
- `src/mock-model.ts`: 离线回退适配器
- `src/permissions.ts`: 路径、命令、编辑审批与 allowlist / denylist
- `src/session.ts`: 多会话持久化，追加写入 JSONL，parentUuid 树结构，compact boundary，会话分叉，过期清理
- `src/memory.ts`: 分层指令文件加载（`MINI.md` / `CLAUDE.md` / `.mini-code/rules/*.md`），向上目录递归，`@path` include，`/memory` 报告，内容去重，容量限制渲染
- `src/init.ts`: 项目初始化 — 创建 `.mini-code/`，向 `.gitignore` 追加 MiniCode 条目，根据项目结构检测生成 `MINI.md` 模板（语言、框架、验证命令）。幂等 `/init` 命令。
- `src/file-review.ts`: 写文件前 diff review
- `src/tui/*`: transcript / chrome / input / screen / markdown 终端组件

## 运行时状态模型

MiniCode 的运行时状态有意保持简单：

- 对话消息在单轮执行期间保存在内存中，并在成功回合后追加写入会话日志。
- 会话按工作目录存储在 `~/.mini-code/projects/`，格式为 JSONL 事件；普通事件通过 `parentUuid` 串联，压缩历史通过 compact boundary 标记。
- 恢复会话时会从最近的 compact boundary 之后加载消息，而 transcript 重建仍可以读取完整事件流。
- provider usage 会附着在 assistant 侧 response boundary 上；只要 usage 仍然 fresh，就作为上下文记账的事实来源。
- 本地 token 估算只作为 provider usage 缺失时的 fallback，或作为最新 provider usage boundary 之后新增消息的 tail estimate。
- 超大工具输出会被移出 prompt context，保存到 `~/.mini-code/tool-results/`，模型只看到预览和完整输出路径。

## Multi-agent MVP

MiniCode 的 multi-agent 实现刻意保持为一个可读的最小闭环：

1. root agent 调用 `spawn_agent` 创建内存态 worker；每个 worker 有独立的消息数组和 `AbortController`。
2. worker 与 root 共用同一个模型适配器，但每次模型请求都显式传入自己的工具列表。worker 只拥有 `list_files`、`grep_files`、`read_file`、`load_skill`、`web_fetch` 和 `web_search`。
3. worker 不能写文件、执行命令、询问用户或继续创建 agent；所有代码修改都由 root agent 完成。
4. 同时最多有 3 个 `running` worker。`wait_agent` 收集报告，`close_agent` 会取消正在进行的模型请求，并阻止 worker 进入下一个工具或模型步骤。
5. TUI 底栏在 worker 运行时显示醒目的 `SUB-AGENTS n/3 RUNNING` 状态。主 TUI 仍保持单前台回合的交互模型。

这个 MVP 暂不持久化 worker，不读取 `.claude/agents`，不允许嵌套 agent，也不实现工作树隔离或用户实时 steering。这样可以把教学重点放在“独立上下文 + 受限工具集 + 后台 Promise + 生命周期控制”四个核心概念上。

## 为什么适合学习

MiniCode 的一个优势，是用更轻量的实现方式，提供了类 Claude Code 的功能体验和核心架构思路。

这让它很适合用来：

- 学习 terminal coding agent 的基本组成
- 研究 tool-calling loop
- 理解 root/worker 的上下文隔离、工具隔离和取消机制
- 理解权限审批和文件 review 流程
- 理解如何在不引入重型插件平台的情况下接入 skills 和 MCP
- 理解一种更接近 Claude Code 的“前台工具执行 / 后台 shell task”区分方式
- 研究会话恢复、compact boundary、provider usage 与大输出落盘如何整合进一个紧凑 runtime
- 试验终端 UI 的组织方式
- 在小代码量基础上继续做自己的定制开发

## 后续优化方向：

1. 更完整的虚拟滚动 transcript
2. 更完整的输入编辑行为
3. 更细的工具执行状态面板
4. 会话历史与项目记忆（会话持久化与基础分层 memory 加载已实现）
5. 更强的 UI 组件化
