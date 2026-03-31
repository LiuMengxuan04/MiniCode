# MiniCode

[English](./README.md)

MiniCode 是一个轻量级的终端编码助手，面向本地开发工作流。

它专注于紧凑的工具调用闭环、实用的文件操作能力，以及一个简洁的全屏 CLI 交互体验。

它的一个明显优势是：用更轻量的实现方式，提供了类 Claude Code 的功能体验和架构思路，因此很适合拿来学习和实验。

## 功能亮点

- 单轮支持多步工具执行的 coding loop
- 支持读文件、搜代码、写文件、补丁修改和命令执行
- 文件修改前可 review diff
- 提供交互式安装器和本地配置目录
- 提供全屏终端 UI、命令菜单、对话视图和输入历史
- 兼容 Anthropic 风格接口
- 适合作为学习类 Claude Code 工作流与架构的轻量代码库

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

配置会保存在：

- `~/.mini-code/settings.json`

启动命令会安装到：

- `~/.local/bin/minicode`

如果 `~/.local/bin` 不在你的 `PATH` 中，可以添加：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 快速开始

```bash
minicode
```

本地开发运行：

```bash
npm run dev
```

离线演示模式：

```bash
MINI_CODE_MODEL_MODE=mock npm run dev
```

## 内置工具

- `list_files`
- `grep_files`
- `read_file`
- `write_file`
- `edit_file`
- `patch_file`
- `modify_file`
- `run_command`

MiniCode 可以在终端工作流中完成文件检查、代码修改和验证命令执行。

## 本地命令

- `/help`
- `/tools`
- `/status`
- `/model`
- `/model <name>`
- `/config-paths`

CLI 同时支持命令提示、对话滚动、输入编辑和历史记录。

## 配置

配置示例：

```json
{
  "model": "your-model-name",
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "ANTHROPIC_AUTH_TOKEN": "your-token",
    "ANTHROPIC_MODEL": "your-model-name"
  }
}
```

配置优先级：

1. `~/.mini-code/settings.json`
2. 兼容的本地已有配置
3. 当前进程环境变量

## 项目结构

- `src/index.ts`: CLI 入口
- `src/agent-loop.ts`: 多步模型/工具循环
- `src/tool.ts`: 工具注册与执行
- `src/tools/*`: 内置工具集合
- `src/tui/*`: 终端 UI 模块
- `src/config.ts`: 运行时配置加载
- `src/install.ts`: 交互式安装器

## 架构文档

- [Architecture Overview](./ARCHITECTURE.md)
- [架构说明](./ARCHITECTURE_ZH.md)

## 开发说明

```bash
npm run check
```

MiniCode 有意保持小而实用。目标是让整体架构足够清晰、易改造、易扩展。
