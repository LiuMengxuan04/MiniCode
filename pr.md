# PR：修复本地快捷命令解析边界问题

## 中文

### 概述

本 PR 修复了 `parseLocalToolShortcut` 中两个轻量级解析问题：

1. `/lsfoo` 会被错误解析成 `/ls foo`。
2. 文件编辑类快捷命令接受空路径，导致问题延后到工具/schema 层才失败。

修复后，解析器会更早拒绝这些无效快捷命令，同时保持正常快捷命令行为不变。

### Bug 1：`/lsfoo` 被解析成 `/ls foo`

#### 复现方式

运行以下解析检查：

```ts
parseLocalToolShortcut('/lsfoo')
```

#### 修复前

解析器只判断输入是否以 `/ls` 开头，因此 `/lsfoo` 会得到：

```ts
{
  toolName: 'list_files',
  input: { path: 'foo' },
}
```

这不符合预期，因为 `/lsfoo` 不是 `/ls` 命令加路径，而是一个相邻的未知命令文本。

#### 修复后

解析器只接受：

```text
/ls
/ls <path>
```

因此现在会返回：

```ts
null
```

### Bug 2：文件编辑快捷命令接受空路径

#### 复现方式

运行以下解析检查：

```ts
parseLocalToolShortcut('/write ::content')
parseLocalToolShortcut('/modify ::content')
parseLocalToolShortcut('/edit   ::before::after')
```

#### 修复前

这些命令会被解析成带空 `path` 的工具调用，例如：

```ts
{
  toolName: 'write_file',
  input: {
    path: '',
    content: 'content',
  },
}
```

之后才会在校验或权限处理阶段失败。

#### 修复后

快捷命令解析阶段会直接拒绝空路径：

```ts
null
```

这与 `/read` 已有的空路径处理保持一致。

### 改动内容

- 收紧 `/ls` 匹配条件，只接受精确 `/ls` 或 `/ls ` 后接路径。
- 将 `/ls` 路径提取从宽松替换改为固定前缀切片。
- 为以下命令增加解析阶段的空路径校验：
  - `/write`
  - `/modify`
  - `/edit`
- 在 `test/local-tool-shortcuts.test.ts` 中新增覆盖上述边界行为的测试。

### 验证

已运行：

```sh
npm run check
node --import tsx --test test/local-tool-shortcuts.test.ts
npm test
```

结果：

- TypeScript 检查通过。
- 本地快捷命令解析测试通过。
- 全量测试通过：155 个测试全部通过。

## English

### Summary

This PR fixes two small parsing issues in `parseLocalToolShortcut`:

1. `/lsfoo` was incorrectly treated as `/ls foo`.
2. File edit shortcuts with blank paths were accepted by the shortcut parser and failed later in the tool/schema layer.

The parser now rejects these invalid shortcuts earlier while preserving valid behavior for normal shortcut usage.

### Bug 1: `/lsfoo` is parsed as `/ls foo`

#### Reproduction

Run this parser check:

```ts
parseLocalToolShortcut('/lsfoo')
```

#### Before

The parser matched any input starting with `/ls`, so `/lsfoo` produced:

```ts
{
  toolName: 'list_files',
  input: { path: 'foo' },
}
```

This is surprising because `/lsfoo` is not the `/ls` command with a path. It is an adjacent unknown command token.

#### After

The parser only accepts:

```text
/ls
/ls <path>
```

So this now returns:

```ts
null
```

### Bug 2: Blank file paths are accepted for edit shortcuts

#### Reproduction

Run these parser checks:

```ts
parseLocalToolShortcut('/write ::content')
parseLocalToolShortcut('/modify ::content')
parseLocalToolShortcut('/edit   ::before::after')
```

#### Before

These commands were parsed into tool calls with an empty `path`, for example:

```ts
{
  toolName: 'write_file',
  input: {
    path: '',
    content: 'content',
  },
}
```

The command would then fail later in validation or permission handling.

#### After

The shortcut parser rejects blank paths directly:

```ts
null
```

This matches the existing behavior of `/read`, which already rejects empty paths at parse time.

### Changes

- Tightened `/ls` matching to accept only exact `/ls` or `/ls ` followed by a path.
- Replaced loose `/ls` removal with fixed-prefix slicing.
- Added parse-time blank path validation for:
  - `/write`
  - `/modify`
  - `/edit`
- Added tests for both edge cases in `test/local-tool-shortcuts.test.ts`.

### Verification

Commands run:

```sh
npm run check
node --import tsx --test test/local-tool-shortcuts.test.ts
npm test
```

Results:

- TypeScript check passed.
- Local shortcut parser tests passed.
- Full test suite passed: 155 tests passing.
