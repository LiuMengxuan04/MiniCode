# 通过 MiniCode 你可以学习到 Claude Code 的哪些设计

## 1. Agent Loop

### Claude Code 的设计方案

Claude Code 的主体是一个持续推进的 agent loop。系统围绕同一条主控制流运转：

- 接收用户输入
- 组织当前上下文
- 请求模型
- 根据模型输出决定是否调用工具
- 执行工具
- 把工具结果继续回传给模型
- 在满足结束条件时结束当前回合

### 通过 MiniCode 可以看到的对应实现

MiniCode 的核心也是一个多步推进的回合循环。终端交互、工具系统、权限系统、MCP、skills 都围绕这条 loop 组织。

## 2. 结构化消息模型

### Claude Code 的设计方案

Claude Code 把会话中的不同状态拆成不同类型的消息或事件，用于区分：

- 用户输入
- assistant 最终回答
- 中间进度
- 工具调用
- 工具结果
- 上下文压缩后的边界或摘要信息

### 通过 MiniCode 可以看到的对应实现

MiniCode 没有把 transcript 只当作字符串列表处理，而是引入了结构化消息角色。当前项目区分了普通 assistant、progress、tool call、tool result 以及 context summary。loop 判定、TUI 展示和上下文压缩建立在这些状态之上。

## 3. Tool Use 作为协议

### Claude Code 的设计方案

Claude Code 里的工具调用是一套统一协议：

- 模型声明工具调用
- 系统解析工具输入
- 权限系统参与判断
- 工具执行后返回标准化结果
- 结果再进入下一轮模型推理

### 通过 MiniCode 可以看到的对应实现

MiniCode 采用了统一工具协议。工具有统一注册、统一 schema、统一执行入口和统一结果格式。本地工具与 MCP 动态接入的远端工具也被纳入同一层抽象。

## 4. Progress 与 Final 分离

### Claude Code 的设计方案

Claude Code 把“正在执行中的说明”和“真正的最终回答”分开处理。系统不会因为模型输出了一段过程性文本，就直接判断当前回合结束。

### 通过 MiniCode 可以看到的对应实现

MiniCode 也把中间态和最终态拆开了。progress 单独建模和渲染，不再一律落成最终 assistant 消息。回合结束条件也不再只依赖自然语言文本。

## 5. 权限与审批属于执行路径本身

### Claude Code 的设计方案

Claude Code 的权限系统属于执行路径的一部分。命令执行、文件修改等高风险行为都处于统一的审批和安全边界之内。

### 通过 MiniCode 可以看到的对应实现

MiniCode 也采用了相同的架构选择。命令执行前审批、文件修改前 review、单回合允许记忆、拒绝后给模型反馈，都纳入主回合执行过程。

## 6. MCP 作为动态能力接入层

### Claude Code 的设计方案

Claude Code 对 MCP 的设计重点是动态接入外部 server 暴露的能力。MCP 在这里承担能力发现、能力挂载和统一接入的角色。

### 通过 MiniCode 可以看到的对应实现

MiniCode 沿用了这个方向。项目在启动或运行时读取 MCP 配置，连接远端 server，发现其暴露的 tools，并统一挂载到本地工具表中。除了 tools 之外，resources 和 prompts 也通过统一 helper tools 暴露。

## 7. Skills 作为轻量工作流扩展

### Claude Code 的设计方案

Claude Code 的 skills 更像工作流扩展，而不是重型插件系统。重点在于：

- 用较轻的形式提供任务说明
- 允许系统在需要时加载特定工作流
- 让扩展可以直接参与模型执行过程

### 通过 MiniCode 可以看到的对应实现

MiniCode 在 skills 上采用了同样的轻量思路。项目通过本地 `SKILL.md` 发现和加载技能，把它们作为 prompt 和任务执行的一部分。

## 8. 自动上下文压缩

### Claude Code 的设计方案

Claude Code 的上下文压缩不是简单删除旧消息，而是把较早上下文转化为可继续工作的摘要，同时保留新的上下文片段。上下文管理也不应该只凭“感觉对话变长了”来触发，而应该尽量贴近真实模型预算。

### 通过 MiniCode 可以看到的对应实现

MiniCode 也采用了这个方向。项目会在长会话中自动检查上下文规模，在达到阈值时使用两种互补策略：**裁剪压缩**（snip compact：确定性移除中段历史，保护文件编辑和出错轮次）和**上下文折叠**（context collapse：投影层摘要对话片段）。自动压缩的触发来自结构化 context stats，而不是简单消息数量。

## 9. Provider Usage 作为上下文事实来源

### Claude Code 的设计方案

一个产品级 coding agent 不应该只依赖本地 token 猜测。如果 provider 返回 usage metadata，那么它就是当前上下文大小最接近事实的数据来源；本地估算仍然有价值，但更适合作为 provider 不返回 usage 时的 fallback，或用于最新 provider boundary 之后追加消息的 tail estimate。

### 通过 MiniCode 可以看到的对应实现

MiniCode 会把 provider usage 记录在 assistant response boundary 上，并把它作为上下文记账的主要来源。如果 boundary 之后又追加了新消息，MiniCode 会补上本地 tail estimate，并标记来源，例如 `usage+est`。如果压缩后旧 usage 已经不再代表当前上下文，MiniCode 会把它标记为 stale，避免继续误用旧 provider total。

这样 TUI context badge、warning/blocking 级别和 auto-compact 触发，都基于同一份 accounting result。

## 10. 会话事件、恢复与分叉

### Claude Code 的设计方案

长时间运行的 coding agent 不能只靠内存里的 chat buffer。它需要一个可持久化的 session model，能够跨进程退出恢复工作，也要保留足够结构，帮助系统理解对话是如何演进的。

### 通过 MiniCode 可以看到的对应实现

MiniCode 按工作目录把会话保存为追加写入的 JSONL events。每个事件都带有 session ID、timestamp、cwd 和 parent linkage 等元信息。运行时可以恢复会话、重命名会话、开启新会话、把已有会话分叉为独立副本，并清理过期会话。

compact boundary 也会作为事件写入。恢复会话时，MiniCode 可以从最近的 compact boundary 之后加载消息，同时仍然可以从完整事件日志重建 transcript。

## 11. 大工具结果应当离开 Prompt

### Claude Code 的设计方案

工具结果可能远大于其中真正有用的信息。coding agent 需要保护模型上下文，避免超大命令输出、日志、生成文件或搜索结果占满 prompt。这里的关键设计是区分“系统仍可访问完整数据”和“完整数据直接塞进 prompt”。

### 通过 MiniCode 可以看到的对应实现

MiniCode 会把超大的 tool result 持久化到本地数据目录，并在模型可见上下文里替换成短预览和完整输出路径。单个超大结果和过大的工具结果批次，都会在进入下一次模型请求前被压缩到更小的可见内容。

这样完整数据仍然可以被检查，但不会挤占对话历史、最近修改和任务意图这些更重要的上下文。

## 12. TUI 作为状态机的可视化层

### Claude Code 的设计方案

Claude Code 的终端界面不是单纯输出文本，而是在展示内部状态机。工具运行、完成、失败，进度消息、最终消息、审批状态等都属于不同状态的可视化呈现。

### 通过 MiniCode 可以看到的对应实现

MiniCode 的 TUI 也采用这个方向。当前终端界面不仅显示最终回答，还会显示工具运行状态、progress 消息、审批状态以及折叠后的工具结果摘要。

## 13. 前台工具执行与后台 Shell Task 分离

### Claude Code 的设计方案

Claude Code 不会把所有命令都当作同一种同步工具调用处理。对于会持续运行、可以脱离当前回合继续存在的 shell 命令，系统会把它们建模成独立 task，而不是继续伪装成一个尚未返回的普通工具调用。

### 通过 MiniCode 可以看到的对应实现

MiniCode 现在也开始采用这个方向。对于明确后台化的 shell 命令，系统不再把它们继续记成普通 `run_command` 的同步执行，而是注册成最小版 background shell task，由 TUI 单独展示状态。这一层不是完整复刻 Claude Code 的任务系统，但已经体现出“前台工具执行”和“后台 shell task”应当分开建模的思路。

## 14. 借鉴与轻量化的边界

### Claude Code 的设计方案

Claude Code 是完整产品级系统，很多设计建立在更大的状态管理、上下文管理和交互体系之上。

### 通过 MiniCode 可以看到的对应实现

MiniCode 保留的是核心设计方案，而不是完整搬运所有实现细节。项目当前保留的是：

- loop-first 的主结构
- 结构化消息
- 统一工具协议
- 审批嵌入执行路径
- MCP 动态接入
- skills 工作流扩展
- usage-aware 的上下文记账与自动压缩
- 持久化会话、恢复与分叉
- 大工具结果移出 prompt context
- 状态化 TUI
- 前台工具与后台 shell task 分离

它对应的是一个小体量的 Claude Code 风格参考实现，而不是完整复刻版本。
