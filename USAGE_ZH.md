# MiniCode 详细使用指南

[返回 README](./README.zh-CN.md) | [English](./USAGE.md)

这份文档承接原 README 中偏操作手册的内容：完整命令、长会话、配置、Skills/MCP、项目结构和代码规模。主 README 现在只保留项目入口和核心介绍。

## 目录

- [功能细节](#功能细节)
- [安装细节](#安装细节)
- [快速开始](#快速开始)
- [命令](#命令)
- [分层 Memory 与项目初始化](#分层-memory-与项目初始化)
- [长会话与上下文管理](#长会话与上下文管理)
- [配置](#配置)
- [Skills 与 MCP 用法](#skills-与-mcp-用法)
- [产品介绍展示页](#产品介绍展示页)
- [项目结构](#项目结构)
- [代码规模](#代码规模)
- [开发说明](#开发说明)

## 功能细节

### 核心工作流

- 单轮支持多步工具执行
- `model -> tool -> model` 闭环
- 全屏终端交互界面
- 输入历史、transcript 滚动和 slash 命令菜单
- 按项目隔离的会话持久化，支持恢复、重命名、分叉和压缩
- 模型感知的上下文统计，支持 provider usage、tail estimate、自动压缩、上下文折叠和裁剪压缩
- 支持通过 `SKILL.md` 发现本地 skills
- 支持通过 stdio 动态加载 MCP tools
- 支持通过通用 MCP helper tools 访问 resources 和 prompts

### 内置工具

- `list_files`
- `grep_files`
- `read_file`
- `write_file`
- `edit_file`
- `patch_file`
- `modify_file`
- `run_command`
- `web_fetch`
- `web_search`
- `ask_user`
- `update_plan`（仅 root agent）
- `load_skill`
- `list_mcp_resources`
- `read_mcp_resource`
- `list_mcp_prompts`
- `get_mcp_prompt`

### 安全性与可用性

- 文件修改前先 review diff
- 路径和命令权限检查
- 独立配置目录和交互式安装器
- 支持 Anthropic 风格接口
- 超大工具结果会落盘保存，并在上下文里替换成短预览和文件路径，避免长命令输出挤占有效对话空间

### 最近交互改进

- 审批对话支持上下键选择与 Enter 确认，也支持选项上的字母/数字快捷键
- 支持“拒绝并给模型反馈”，可直接把修正建议发回模型
- 编辑审批支持“本轮允许此文件”与“本轮允许全部编辑”
- diff 预览改为标准 unified diff（更接近 `git diff`）
- 审批页面支持 `Ctrl+O` 展开/收起与滚轮/分页滚动
- 审批弹窗打开时也支持 `Ctrl+C` 干净退出
- 工具调用结果自动折叠为摘要，减少 transcript 噪音
- 通过 `run_command` 启动的显式后台 shell 命令，现在会以轻量 shell task 的形式呈现，不再卡成一个永远 running 的普通工具调用
- TTY 输入事件现在串行处理，并且会把 CRLF 的 Enter 合并成一次确认，避免审批弹窗被重复触发
- 修复了审批阶段可能导致上下键/Enter 无响应的输入事件死锁问题
- 加固 ESC 序列解析，异常终端输入不会再卡住按键处理
- `run_command` 支持 `"git status"` 这类单字符串命令输入，并自动拆分参数
- 澄清问题改为通过 `ask_user` 结构化发问，并在用户回复前暂停当前回合
- 上下文 token 记账已改为 provider usage 驱动：供应商返回的 usage 会作为 context stats、自动压缩触发、warning/blocking 级别和 TUI context badge 的主要来源；本地估算器只在 provider 未返回 usage 或最新 usage boundary 之后存在新增消息时作为 fallback/tail estimate
- TUI context badge 会区分真实 usage 和估算 tail，例如 `ctx 82% ... usage+est`；压缩后的会话会把保留下来的旧 usage 标记为 stale，避免把压缩前的 usage 当作当前上下文真实值
- 大工具结果会持久化到 MiniCode 的本地数据目录，并在模型上下文里替换为预览和文件路径；同一个结果的重复处理会复用替换内容，让 token accounting 保持稳定
- 确定性裁剪压缩（snip compact）会安全地移除中段历史消息，同时保护文件编辑和出错轮次，保留近期对话完整
- 上下文折叠（context collapse）投影层能识别长对话中可摘要的片段，替换为简洁摘要以保持在 context window 限制内
- Anthropic thinking block 现在会在跨工具调用轮次间保留，确保多步工具执行过程中思维链的连续性

## 安装细节

```bash
cd mini-code
npm install
npm run install-local
```

安装器会询问：

- 模型名称
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`

配置保存在：

- `~/.mini-code/settings.json`
- `~/.mini-code/mcp.json`

你可以通过 `MINI_CODE_HOME` 自定义配置目录：

```bash
export MINI_CODE_HOME=/path/to/custom/dir
npm run install-local
```

启动命令安装到：

- `~/.local/bin/minicode`

你可以通过 `MINI_CODE_BIN_DIR` 自定义启动器目录：

```bash
export MINI_CODE_BIN_DIR=/path/to/custom/bin
npm run install-local
```

如果 `~/.local/bin` 不在你的 `PATH` 中，可以添加：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 快速开始

运行安装后的命令：

```bash
minicode
```

本地开发模式：

```bash
npm run dev
```

离线演示模式：

```bash
MINI_CODE_MODEL_MODE=mock npm run dev
```

## 命令

### 管理命令

- `minicode mcp list`
- `minicode mcp add <name> [--project] [--protocol <mode>] [--url <endpoint>] [--header KEY=VALUE ...] [--env KEY=VALUE ...] [-- <command> [args...]]`
- `minicode mcp login <name> --token <bearer-token>`
- `minicode mcp logout <name>`
- `minicode mcp remove <name> [--project]`
- `minicode skills list`
- `minicode skills add <path> [--name <name>] [--project]`
- `minicode skills remove <name> [--project]`

### 本地 slash 命令

- `/help`
- `/tools`
- `/plan`
- `/skills`
- `/mcp`
- `/status`
- `/init`
- `/memory`
- `/model`
- `/model <name>`
- `/config-paths`

### Plan / Todo（内存最简版）

可以要求 Agent 为多步任务维护清单，例如：

```text
阅读搜索功能的实现，梳理测试覆盖情况，用 update_plan 跟踪步骤，暂不修改文件。
```

`update_plan` 接收完整 Todo 列表：已有条目携带工具返回的 ID，新条目省略 `id`。同一个工具支持新增、改名、删除、重排、完成和重开，可用可选的 `explanation` 简述调整原因。三种状态分别为 `pending`（`[ ]`）、`in_progress`（`[>]`，即 Active）和 `completed`（`[x]`）。最多一个条目为 Active；非法更新不会改变原清单。空列表用于清空，全部完成的清单仍保留展示。

输入 `/plan` 即可查看，无需调用模型。更新成功后，TUI 的工具结果也会显示清单。每次 root 模型请求都会注入最新 Plan，压缩上下文后仍然有效；只读 sub-agent 不能修改 Plan。Plan 不调度执行，即使还有未完成项，普通 final 也会正常结束当前回合。

本阶段只在内存中保留当前会话的 Plan。重启、`/new`、`/resume` 或 `/fork` 后清单为空；历史中的旧工具消息不用于恢复 Plan。`/compact` 与上下文投影不清空当前 Plan。手工编辑命令、Todo 选择交互和持久化留到下一阶段。

### 终端交互能力

- 命令提示与 slash 菜单
- transcript 滚动
- 输入编辑
- 历史输入导航
- 审批界面上下键选择与反馈输入（也支持快捷键直接选择）

### 会话管理

MiniCode 每轮对话后自动保存。每次启动会创建新的会话，分配唯一 ID。

- `/resume`：打开会话选择器
- `/resume <id>`：恢复指定会话
- `/rename <name>`：重命名当前会话
- `/new`：开始新会话（旧会话保留）
- `/fork`：将当前会话分叉为独立副本
- `/compact`：压缩上下文，释放 context window 空间

CLI 参数：

- `minicode --resume`：启动时打开会话选择器
- `minicode --resume <id>`：恢复指定会话
- `minicode --fork <id>`：分叉指定会话并恢复

会话按工作目录隔离，存储在 `~/.mini-code/projects/`，采用追加写入的 JSONL 格式。退出时会打印 session ID，方便后续恢复。超过 30 天的会话会自动清理。

## 分层 Memory 与项目初始化

MiniCode 启动时从三层层级加载指令文件：

1. **用户全局**：`~/.mini-code/MINI.md`（同时兼容读取 `~/.mini-code/CLAUDE.md`），以及按文件名排序的 `~/.mini-code/rules/*.md`
2. **项目根及祖先目录**：从 cwd 向上递归，读取 `MINI.md`、`MINI.local.md`、`.mini-code/MINI.md`、`CLAUDE.md`、`CLAUDE.local.md`、`.claude/CLAUDE.md`，以及每层按文件名排序的 `.mini-code/rules/*.md`
3. **优先级**：越靠近 cwd 的内容优先级越高

相同内容的文件会自动去重。单文件上限约 8k 字符，总量上限约 20k 字符。在交互 UI 中输入 `/memory` 可以查看实际加载的文件、scope、行数、字符数和首行预览。

指令文件支持用单独一行 `@relative/path.md` 引入其他文件。include 路径相对当前指令文件解析；绝对路径和包含父目录跳转（`..`）的路径会被跳过，循环 include 会被检测并跳过。

`/init` 会为当前项目初始化 `.mini-code/`、`.mini-code/rules/` 和 `MINI.md`，并把本地生成的私有规则文件加入 `.gitignore`。

`MINI.md` 示例：

```markdown
# 项目规则

- 使用 TypeScript strict 模式。
- 提交前运行 `npm run check`。
- 保持改动最小且聚焦。

@.mini-code/rules/testing.md
```

## 长会话与上下文管理

MiniCode 现在把长会话作为一等工作流处理：

- 模型接口返回 provider usage 时，MiniCode 会把它记录在 assistant response boundary 上，并作为 token 记账的主数据源。
- 如果最新 provider usage boundary 之后又追加了消息，MiniCode 会补充本地 tail estimate，并在 badge 中标记来源，例如 `usage+est`。
- 如果 provider 不返回 usage，MiniCode 会回退到本地估算，因此离线模式和兼容网关仍然可用。
- 上下文统计会驱动 TUI badge、warning/blocking 级别和自动压缩触发。
- `/compact` 会手动压缩上下文（使用裁剪压缩或上下文折叠），并在会话日志中写入 compact boundary。
- 当上下文利用率过高时，自动压缩会自动触发，使用**裁剪压缩**（snip compact：确定性移除中段历史，保护编辑和出错轮次）或**上下文折叠**（context collapse：投影层摘要对话片段）来为后续对话腾出空间。
- 压缩后，保留下来的压缩前 usage 会被标记为 stale，避免把旧 provider 总量误认为当前上下文大小。
- Anthropic 兼容接口返回可识别的 HTTP 400 提示词过长错误时，MiniCode 会尝试确定性裁剪并最多重试两次，不额外调用模型生成摘要。如果无法安全裁剪或重试耗尽，则报告请求错误。Plan 和运行时上下文仅注入请求，不写入历史；取消操作仍可停止重试。
- 超大工具结果会写入 `~/.mini-code/tool-results/`，并在可见上下文里替换成预览和完整输出路径。单个结果超过 `50_000` 字符会落盘；一批工具结果会被压到约 `200_000` 字符的可见预算内。

会话存储和上下文压缩会一起工作：`loadSession` 会从最近的 compact boundary 之后恢复，而 `loadTranscript` 仍然可以从 JSONL 事件日志重建可见 transcript。

## 配置

配置示例：

```json
{
  "model": "your-model-name",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "remote-example": {
      "protocol": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  },
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_MODEL": "your-model-name"
  }
}
```

也支持 Claude Code 风格的项目级 `.mcp.json`：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

为了兼容不同厂商的 MCP 实现，MiniCode 现在会自动协商 stdio framing：

- 默认先尝试标准 MCP 的 `Content-Length` framing
- 如果失败，再自动回退到按行分隔的 JSON
- 也可以在单个 server 上通过 `"protocol": "content-length"` 或 `"protocol": "newline-json"` 强制指定
- 远程 MCP 可使用 `"protocol": "streamable-http"`，并配置 `"url"`（可选 `"headers"`）
- header 的值支持环境变量插值，例如 `"Authorization": "Bearer $MCP_TOKEN"`

远程 MCP 认证策略（保持轻量）：

- 使用 `minicode mcp login <name> --token <bearer-token>` 本地保存 bearer token
- 使用 `minicode mcp logout <name>` 清除已保存 token
- 当前版本有意采用 token 方案，不内置完整 OAuth 回调 + refresh 状态机
- 这样可以保持实现简洁并符合 MiniCode 轻量架构目标；后续确有需要再补完整 OAuth 自动化

Skills 默认会从这些位置发现：

- `./.mini-code/skills/<skill-name>/SKILL.md`
- `~/.mini-code/skills/<skill-name>/SKILL.md`
- `./.claude/skills/<skill-name>/SKILL.md`
- `~/.claude/skills/<skill-name>/SKILL.md`

配置优先级：

1. `~/.mini-code/settings.json`
2. `~/.mini-code/mcp.json`
3. 项目级 `.mcp.json`
4. 兼容的本地已有配置
5. 当前进程环境变量

## Skills 与 MCP 用法

MiniCode 现在支持两类扩展：

- `skills`：本地工作流说明，一般由一个 `SKILL.md` 描述如何完成某类任务
- `MCP`：外部工具源，启动后会把远端 server 暴露的 tools / resources / prompts 接入 MiniCode

### Skills：安装、查看、触发

安装一个本地 skill：

```bash
minicode skills add ~/minimax-skills/skills/frontend-dev --name frontend-dev
```

查看已发现的 skills：

```bash
minicode skills list
```

进入交互界面后，也可以用：

```text
/skills
```

来检查当前会话里可用的 skills。

如果你明确提到 skill 名，MiniCode 会优先加载它。比如：

```text
请使用 frontend-dev skill，直接重构当前 landing page，不要只停在方案说明。
```

也可以更明确地要求先读 skill：

```text
先加载 fullstack-dev skill，再根据这个 skill 的工作流实现当前需求。
```

一个常见用法是把官方或兼容 Claude Code 的 skills 仓库 clone 到本地后再安装：

```bash
git clone https://github.com/MiniMax-AI/skills.git ~/minimax-skills
minicode skills add ~/minimax-skills/skills/frontend-dev --name frontend-dev
```

### MCP：安装、查看、触发

安装一个用户级 MCP server：

```bash
minicode mcp add MiniMax --env MINIMAX_API_KEY=your-key --env MINIMAX_API_HOST=https://api.minimaxi.com -- uvx minimax-coding-plan-mcp -y
```

查看当前已配置的 MCP：

```bash
minicode mcp list
```

如果你想只给当前项目配置 MCP，可以加 `--project`：

```bash
minicode mcp add filesystem --project -- npx -y @modelcontextprotocol/server-filesystem .
minicode mcp list --project
```

进入交互界面后，可以用：

```text
/mcp
```

查看当前会话里哪些 server 已连接、用了什么协议、暴露了多少 tools / resources / prompts。

MCP tools 会自动注册成：

```text
mcp__<server_name>__<tool_name>
```

例如安装 MiniMax MCP 后，你可能会看到：

- `mcp__minimax__web_search`
- `mcp__minimax__understand_image`

这些工具不需要手动声明，server 连接成功后会自动出现在工具列表中。

### 在对话里怎么用

最简单的方式是直接自然语言描述需求，让模型自己决定是否调用 skill 或 MCP tool：

```text
搜索一下最近关于 MCP 的中文资料，给我 5 条有代表性的链接。
```

如果当前已连接 MiniMax MCP，模型通常会自动选择 `mcp__minimax__web_search`。

如果你想更稳一些，可以把 skill 或目标写清楚：

```text
请使用 frontend-dev skill，直接修改当前项目文件，把页面重做成更完整的产品落地页。
```

或者：

```text
请使用已连接的 MCP 工具帮我搜索 MiniMax MCP guide，并总结它提供了哪些能力。
```

### 什么时候用 skills，什么时候用 MCP

- `skills` 更适合沉淀工作流、规范、领域经验
- `MCP` 更适合接入搜索、图片理解、外部系统、数据库、浏览器、文件系统等远端能力

一个常见组合是：

- 用 `frontend-dev` 这类 skill 约束页面改造方式
- 再让已连接的 MCP 提供搜索、图片理解或其他外部能力

### 兼容性说明

MiniCode 当前主要支持：

- 本地 `SKILL.md` 发现与 `load_skill`
- stdio MCP server
- MCP tools
- MCP resources / prompts 的通用 helper tools

为了兼容不同厂商实现，MiniCode 会自动尝试：

- 标准 `Content-Length` framing
- 失败后回退到 `newline-json`

所以像 MiniMax 这类采用按行 JSON 的 MCP server，也可以直接接入。

## 产品介绍展示页

- 在浏览器中打开 [docs/index.html](./docs/index.html)，即可查看可视化产品介绍页面。
- GitHub Pages 推荐访问地址：`https://liumengxuan04.github.io/MiniCode/`

## 项目结构

- `src/index.ts`：CLI 入口
- `src/agent-loop.ts`：多步模型/工具循环
- `src/tool.ts`：工具注册与执行
- `src/skills.ts`：本地 skill 发现与加载
- `src/mcp.ts`：stdio MCP 客户端与动态工具封装
- `src/manage-cli.ts`：顶层 `minicode mcp` / `minicode skills` 管理命令
- `src/session.ts`：追加写入的会话 JSONL、恢复/分叉/重命名、compact boundary 和过期清理
- `src/compact/*`：手动压缩、自动压缩、上下文折叠投影层、确定性裁剪压缩和对话摘要辅助逻辑
- `src/utils/token-estimator.ts`：provider usage 优先的上下文记账与本地估算 fallback
- `src/utils/tool-result-storage.ts`：大工具输出持久化与预览替换
- `src/tools/*`：内置工具集合
- `src/tui/*`：终端 UI 模块
- `src/config.ts`：运行时配置加载
- `src/install.ts`：交互式安装器

## 代码规模

当前核心实现约 **7,874 行**。

统计口径：

- 纳入：核心 TypeScript 源码、内置工具、配置、MCP、会话、压缩、adapter、permissions，以及 `bin/minicode`
- 排除：文档、测试、`external/`、`node_modules/` 和 TUI 文件（`src/tui/`、`src/tty-app.ts`、`src/ui.ts`）

如果只排除 `src/tui/`，但保留 `src/tty-app.ts` 和 `src/ui.ts`，总计约 **9,767 行**。

## 开发说明

```bash
npm run check
npm test
```

MiniCode 有意保持小而实用。目标是让整体架构足够清晰、易改造、易扩展。

## Goal：跨回合推进目标

输入 `/goal <目标描述>` 创建并启动一个进程内 Goal。`/goal` 或 `/goal status` 查看目标、完成标准、状态和共用 Plan。Agent 先通过 `update_plan` 准备非空计划，再用 `update_goal` 设置完成标准。普通 final 只结束一轮；Goal 仍为 active 时会继续下一轮。

- `/goal pause [原因]` 暂停自动执行，在模型请求或审批等待期间也可用。已经开始的工具会收尾并保留结果，同批次剩余调用取消。
- `/goal resume` 显式恢复暂停或阻塞的 Goal。若 `ask_user` 正等待回答，需要先作答；暂停时的回答只记录，不自动恢复。
- `/goal clear` 停止并清除 Goal，保留 Plan 和工作区改动。创建新 Goal 前需先清除已有 Goal。
- `get_goal`、`update_goal` 仅提供给 Goal 回合中的 root agent。Agent 不能创建目标、修改目标原文或自行恢复。
- 完成需要：非空计划、所有 Todo 完成、非空标准、摘要，以及每条标准对应的检查说明。本阶段只做结构检查，不校验工具证据引用。成功提交 completed/blocked 后立即停止同批次后续调用。

每轮最多 50 个模型/工具步骤；连续 3 个自动回合没有工具调用时暂停。模型错误、未处理的工具异常、会话保存失败也会停止自动执行。原有文件和命令审批规则继续生效。

Goal 和 Plan 状态仅保留在当前进程。TUI 的 `/new`、`/resume`、`/fork` 会先停止执行并清除 Goal；重启不会自动恢复。非 TTY 输入也支持 Goal 命令，但不能处理交互审批，输入结束时停止执行。目标更新、持久化、证据引用检查和更完整的 UI 留到后续阶段。

## Loop：重复触发提示词

`/loop [Nm|Nh] <提示词>` 创建一个进程内重复任务，例如 `/loop 5m 检查测试输出，有变化时汇报`。省略间隔时为 10 分钟，最短 1 分钟，数值需在单个 JavaScript 定时器范围内。`/loop` 查看任务，`/loop stop` 停止并清除任务，保留 Plan。

首次在会话空闲时执行；每轮成功 final、工具与会话保存收尾后，再等待完整间隔。到期时若普通回合或本地命令正忙，只保留一次待触发，空闲后执行一次，不累计补跑。两次触发之间可以正常聊天。

Loop 复用同一 Agent 回合和可选 Plan，每轮最多 50 步，不注入 Goal 上下文，也不提供 Goal 工具。Goal/Loop 在启用、执行、停止收尾或等待回答期间互斥；切换模式前先暂停/清除 Goal 或停止 Loop。Goal 尚未回答的问题需要先回答或清除。

`ask_user` 会暂停调度，直到真实回答到达。审批继续使用原有界面，审批等待期间也可输入 `/loop stop`。错误或步数上限会使 Loop 进入 paused。本阶段没有 pause/resume 命令和 `stop_loop` 工具，查看原因后可 stop 并重新创建。

TUI 切换会话及进程退出会取消定时器和正在执行的回合，重启不恢复任务。停止 Loop 不回滚工作区改动，也不终止此前显式启动的独立后台命令。不支持 cron、daemon、多任务和补跑队列。
