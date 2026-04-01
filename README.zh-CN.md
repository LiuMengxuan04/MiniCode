# MiniCode

[English](./README.md) | [架构说明](./ARCHITECTURE_ZH.md) | [通过 MiniCode 学习 Claude Code 设计](./CLAUDE_CODE_PATTERNS_ZH.md) | [License](./LICENSE)

一个面向本地开发工作流的轻量级终端编码助手。

MiniCode 用更小的实现体量，提供了类 Claude Code 的工作流体验和架构思路，因此非常适合学习、实验，以及继续做自己的定制化开发。

## 项目简介

MiniCode 围绕一个实用的 terminal-first agent loop 构建：

- 接收用户请求
- 检查当前工作区
- 在需要时调用工具
- 修改文件前先 review
- 在同一个终端会话里返回最终结果

整个项目有意保持紧凑，这样主控制流、工具模型和 TUI 行为都更容易理解和扩展。

## 目录

- [为什么选择 MiniCode](#为什么选择-minicode)
- [功能特性](#功能特性)
- [安装](#安装)
- [快速开始](#快速开始)
- [命令](#命令)
- [配置](#配置)
- [Skills 与 MCP 用法](#skills-与-mcp-用法)
- [Star 趋势](#star-趋势)
- [项目结构](#项目结构)
- [架构文档](#架构文档)
- [通过 MiniCode 学习 Claude Code 设计](#通过-minicode-学习-claude-code-设计)
- [开发说明](#开发说明)

## 为什么选择 MiniCode

如果你希望得到下面这些东西，MiniCode 会很合适：

- 一个轻量级 coding assistant，而不是庞大的平台
- 一个带 tool calling、transcript 和命令工作流的终端 UI
- 一个很适合阅读和二次开发的小代码库
- 一个可用于学习类 Claude Code agent 架构的参考实现

## 功能特性

### 核心工作流

- 单轮支持多步工具执行
- `model -> tool -> model` 闭环
- 全屏终端交互界面
- 输入历史、transcript 滚动和 slash 命令菜单
- 支持通过 `SKILL.md` 发现本地 skills
- 支持通过 stdio 动态加载 MCP tools
- 支持通过通用 MCP helper tools 访问 resources 和 prompts
- 会在长会话中自动压缩较早上下文，保留最近消息并总结旧历史

### 内置工具

- `list_files`
- `grep_files`
- `read_file`
- `write_file`
- `edit_file`
- `patch_file`
- `modify_file`
- `run_command`
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

### 最近交互改进

- 审批对话支持上下键选择与 Enter 确认（不再依赖字母键）
- 支持“拒绝并给模型反馈”，可直接把修正建议发回模型
- 编辑审批支持“本轮允许此文件”与“本轮允许全部编辑”
- diff 预览改为标准 unified diff（更接近 `git diff`）
- 审批页面支持 `Ctrl+O` 展开/收起与滚轮/分页滚动
- 工具调用结果自动折叠为摘要，减少 transcript 噪音

## 安装

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

启动命令安装到：

- `~/.local/bin/minicode`

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
- `minicode mcp add <name> [--project] [--protocol <mode>] [--env KEY=VALUE ...] -- <command> [args...]`
- `minicode mcp remove <name> [--project]`
- `minicode skills list`
- `minicode skills add <path> [--name <name>] [--project]`
- `minicode skills remove <name> [--project]`

### 本地 slash 命令

- `/help`
- `/tools`
- `/skills`
- `/mcp`
- `/status`
- `/model`
- `/model <name>`
- `/config-paths`

### 终端交互能力

- 命令提示与 slash 菜单
- transcript 滚动
- 输入编辑
- 历史输入导航
- 审批界面上下键选择与反馈输入

## 配置

配置示例：

```json
{
  "model": "your-model-name",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
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

## Star 趋势

<p align="center">
  <a href="https://starchart.cc/LiuMengxuan04/MiniCode">
    <img src="https://starchart.cc/LiuMengxuan04/MiniCode.svg" alt="Stargazers over time" />
  </a>
</p>

## 通过 MiniCode 学习 Claude Code 设计

如果你想把这个项目当成学习材料，可以继续阅读：

- [通过 MiniCode 你可以学习到 Claude Code 的哪些设计](./CLAUDE_CODE_PATTERNS_ZH.md)

## 项目结构

- `src/index.ts`: CLI 入口
- `src/agent-loop.ts`: 多步模型/工具循环
- `src/tool.ts`: 工具注册与执行
- `src/skills.ts`: 本地 skill 发现与加载
- `src/mcp.ts`: stdio MCP 客户端与动态工具封装
- `src/manage-cli.ts`: 顶层 `minicode mcp` / `minicode skills` 管理命令
- `src/tools/*`: 内置工具集合
- `src/tui/*`: 终端 UI 模块
- `src/config.ts`: 运行时配置加载
- `src/install.ts`: 交互式安装器

## 架构文档

- [Architecture Overview](./ARCHITECTURE.md)
- [中文架构说明](./ARCHITECTURE_ZH.md)

## 开发说明

```bash
npm run check
```

MiniCode 有意保持小而实用。目标是让整体架构足够清晰、易改造、易扩展。
