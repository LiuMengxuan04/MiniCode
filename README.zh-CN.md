# MiniCode

<p align="center">
  <img src="./docs/logo.svg" alt="MiniCode Logo" width="180" />
</p>

<h2 align="center">MiniCode</h2>

<p align="center">
  <img src="https://img.shields.io/badge/Editor-Minicode-D97757?style=for-the-badge" alt="Editor: Minicode" />
  <img src="https://img.shields.io/badge/%23minicode-Project-B85C3F?style=for-the-badge" alt="#minicode" />
  <img src="https://img.shields.io/badge/%23lightweight-Focus-F0EBE1?style=for-the-badge&labelColor=8B8B8B" alt="#lightweight" />
  <a href="https://deepwiki.com/LiuMengxuan04/MiniCode">
    <img src="https://img.shields.io/badge/Ask-DeepWiki-0F7BBF?style=for-the-badge&labelColor=2B2B2B" alt="Ask DeepWiki" />
  </a>
</p>

---

<p align="center">
  一个轻量且高效的编码工具。为速度而生，为简洁而建。
</p>

[English](./README.md) | [详细使用指南](./USAGE_ZH.md) | [DeepWiki](https://deepwiki.com/LiuMengxuan04/MiniCode) | [架构说明](./ARCHITECTURE_ZH.md) | [贡献规范](./CONTRIBUTING_ZH.md) | [路线图](./ROADMAP_ZH.md) | [License](./LICENSE)

MiniCode 是一个面向本地开发工作流的轻量级终端编码助手。

它用更小的实现体量，提供类 Claude Code 的工作流体验和架构思路，因此很适合学习、实验，以及继续做自己的定制化开发。

## 项目简介

MiniCode 围绕一个 terminal-first agent loop 构建：

- 接收用户请求
- 检查当前工作区
- 在需要时调用工具
- 修改文件前先 review
- 在同一个终端会话里返回最终结果

整个项目有意保持紧凑，让主控制流、工具模型和 TUI 行为更容易理解和扩展。

## 核心作者

<table>
  <tr>
    <td align="center" valign="top" width="20%">
      <a href="https://github.com/LiuMengxuan04">
        <img src="https://github.com/LiuMengxuan04.png?size=160" width="96" height="96" alt="LiuMengxuan04" /><br />
        <strong>Liu Mengxuan</strong>
      </a>
      <br />
      <sub><strong>发起者</strong></sub>
      <br />
      <sub>主导 TypeScript 主仓库、核心工作流、MCP/Skills、TUI 与文档。</sub>
    </td>
    <td align="center" valign="top" width="20%">
      <a href="https://github.com/GateJustice">
        <img src="https://github.com/GateJustice.png?size=160" width="96" height="96" alt="GateJustice" /><br />
        <strong>GateJustice</strong>
      </a>
      <br />
      <sub><strong>共同发起者</strong></sub>
      <br />
      <sub>贡献长会话上下文系统，包括 usage 记账、自动压缩和 context collapse。</sub>
    </td>
    <td align="center" valign="top" width="20%">
      <a href="https://github.com/harkerhand">
        <img src="https://github.com/harkerhand.png?size=160" width="96" height="96" alt="harkerhand" /><br />
        <strong>harkerhand</strong>
      </a>
      <br />
      <sub><strong>MiniCode-rs</strong></sub>
      <br />
      <sub>Rust 版本主要作者。</sub>
    </td>
    <td align="center" valign="top" width="20%">
      <a href="https://github.com/QUSETIONS">
        <img src="https://github.com/QUSETIONS.png?size=160" width="96" height="96" alt="QUSETIONS" /><br />
        <strong>QUSETIONS</strong>
      </a>
      <br />
      <sub><strong>MiniCode-Python</strong></sub>
      <br />
      <sub>Python 版本主要作者。</sub>
    </td>
    <td align="center" valign="top" width="20%">
      <a href="https://github.com/GoDiao">
        <img src="https://github.com/GoDiao.png?size=160" width="96" height="96" alt="GoDiao" /><br />
        <strong>GoDiao</strong>
      </a>
      <br />
      <sub><strong>核心贡献者</strong></sub>
      <br />
      <sub>贡献分层 memory、/init、会话恢复和 TUI 交互改进。</sub>
    </td>
  </tr>
</table>

简介根据主仓库与多语言分支提交记录归纳。更多贡献者请以仓库提交历史为准。

## 多语言版本

- TypeScript（本仓库）：[MiniCode](https://github.com/LiuMengxuan04/MiniCode)
- Rust 版本：[MiniCode-rs](https://github.com/harkerhand/MiniCode-rs/tree/master)
- Python 版本：[MiniCode-Python](https://github.com/QUSETIONS/MiniCode-Python)
- Java 版本：[MiniCode4j](https://github.com/hobbescalvin414-tech/minicode4j/tree/feat/default-ts-ui)

## 产品展示页

- 在浏览器中打开 [docs/index.html](./docs/index.html)，即可查看可视化产品介绍页面。
- GitHub Pages 推荐访问地址：`https://liumengxuan04.github.io/MiniCode/`

## 为什么选择 MiniCode

MiniCode 适合你，如果你想要：

- 一个轻量级 coding assistant，而不是庞大的平台
- 一个带 tool calling、transcript 和命令工作流的终端 UI
- 一个很适合阅读和二次开发的小代码库
- 一个可用于学习类 Claude Code agent 架构的参考实现

## 核心能力

- 单轮支持多步工具执行，形成 `model -> tool -> model` 闭环。
- 提供全屏终端交互界面，支持输入历史、transcript 滚动、slash 命令菜单和审批交互。
- 会话按项目隔离持久化，支持恢复、重命名、分叉和压缩。
- 上下文统计优先使用 provider usage，并支持 tail estimate、自动压缩、上下文折叠和裁剪压缩。
- 内置文件、搜索、编辑、命令执行、Web fetch/search、澄清提问等工具。
- 支持通过 `SKILL.md` 发现本地 skills，也支持通过 stdio 或远程 HTTP 接入 MCP tools/resources/prompts。
- 文件修改前先 review diff，并对路径和命令执行做权限检查。
- 超大工具结果会落盘保存，并在上下文里替换成短预览和文件路径，减少长输出对对话空间的挤占。

完整命令、配置示例、会话机制和 Skills/MCP 用法已经移到 [详细使用指南](./USAGE_ZH.md)。

## 安装

```bash
cd mini-code
npm install
npm run install-local
```

安装器会询问模型名称、`ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`。默认配置保存在：

- `~/.mini-code/settings.json`
- `~/.mini-code/mcp.json`

可通过 `MINI_CODE_HOME` 自定义配置目录，通过 `MINI_CODE_BIN_DIR` 自定义启动器目录。更多安装细节见 [详细使用指南](./USAGE_ZH.md#安装细节)。

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

## 常用入口

- `/help`：查看交互帮助。
- `/tools`：查看当前可用工具。
- `/skills`：查看当前可发现的 skills。
- `/mcp`：查看当前 MCP 连接状态。
- `/status`：查看会话和上下文状态。
- `/init`：为当前项目生成 `.mini-code/` 与 `MINI.md` 初始化文件。
- `/memory`：查看本轮实际加载的分层 memory 文件。
- `/model` / `/model <name>`：查看或切换模型。
- `/resume`：打开会话选择器。
- `/compact`：手动压缩上下文。

管理命令包括 `minicode mcp ...` 和 `minicode skills ...`，详见 [命令说明](./USAGE_ZH.md#命令)。

## 文档导航

- [详细使用指南](./USAGE_ZH.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [中文架构说明](./ARCHITECTURE_ZH.md)
- [中文贡献规范](./CONTRIBUTING_ZH.md)
- [Contribution Guidelines](./CONTRIBUTING.md)
- [路线图](./ROADMAP_ZH.md)
- [Roadmap](./ROADMAP.md)
- [通过 MiniCode 学习 Claude Code 设计](./CLAUDE_CODE_PATTERNS_ZH.md)

## Star 趋势

<p align="center">
  <a href="https://star-history.com/#LiuMengxuan04/MiniCode&Date">
    <img
      alt="Star History Chart"
      src="https://api.star-history.com/image?repos=LiuMengxuan04/MiniCode&style=landscape1"
    />
  </a>
</p>

## 开发

```bash
npm run check
npm test
```

MiniCode 有意保持小而实用。目标是让整体架构足够清晰、易改造、易扩展。
