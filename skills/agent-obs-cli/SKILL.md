---
name: agent-obs-cli
description: 使用本地 agent-obs-cli 安全操作已配置的华为云 OBS。适用于按桶别名或真实桶名查询桶信息、列举和检查对象、下载对象、上传单个文件、递归批量上传目录，以及安装或验证 Agent skill 的场景。
---

# agent-obs-cli

使用 `agent-obs-cli` 操作配置文件中明确声明的华为云 OBS 桶。不要扫描未知账号，不要输出 AK、SK、SecurityToken、`secret.key` 或 `secrets.json`。

## 基本流程

1. 检查 CLI：

```bash
agent-obs-cli --help
```

2. 列出安全的本地配置摘要：

```bash
agent-obs-cli list
```

3. 使用桶别名或唯一真实桶名。执行对象操作前先验证目标：

```bash
agent-obs-cli test --bucket "<bucket>"
agent-obs-cli bucket-info --bucket "<bucket>"
```

默认配置位于 `~/.agent-obs-cli/config.json`。也可设置 `AGENT_OBS_CLI_CONFIG` 或传入全局参数 `--config <path>`。不要为了排障直接打印完整配置；先用 `list` 获取脱敏摘要。读取包含凭据的原始配置前先取得用户同意。

## 查询

按前缀查询对象。默认最多返回 1000 条；优先使用前缀和分页，不要在大型桶上擅自使用 `--all`。

```bash
agent-obs-cli list-objects --bucket "<bucket>" --prefix "logs/2026/"
agent-obs-cli list-objects --bucket "<bucket>" --prefix "logs/" --marker "<nextMarker>"
agent-obs-cli object-info --bucket "<bucket>" --key "logs/example.json"
```

只有用户明确要求完整结果时才使用：

```bash
agent-obs-cli list-objects --bucket "<bucket>" --prefix "narrow/prefix/" --all
```

## 下载

确认桶、对象 key 和本地输出路径后下载：

```bash
agent-obs-cli download \
  --bucket "<bucket>" \
  --key "reports/report.csv" \
  --output "./report.csv"
```

本地文件已存在时默认拒绝覆盖。只有用户明确同意覆盖该路径后才添加 `--overwrite`。

## 上传

上传会创建或替换远端对象，属于写操作。执行前说明桶、对象 key、本地源文件以及是否覆盖，并取得用户明确同意。

```bash
agent-obs-cli upload \
  --bucket "<bucket>" \
  --file "./report.csv" \
  --key "reports/report.csv"
```

远端对象已存在时默认拒绝。只有用户明确同意覆盖该对象后才添加 `--overwrite`。

## 批量上传

始终先运行 dry-run：

```bash
agent-obs-cli upload-batch \
  --bucket "<bucket>" \
  --source "./assets" \
  --prefix "assets/" \
  --dry-run
```

向用户展示目标桶、prefix、总文件数、计划上传数、冲突跳过数和失败数。用户确认后，使用相同参数移除 `--dry-run` 执行。需要覆盖冲突对象时，单独说明影响并取得明确同意后添加 `--overwrite`。

批量上传递归处理普通文件，不跟随符号链接。任一文件失败时命令返回非零退出码，并在结果中保留逐项状态。

## 安全边界

- 不输出或转述环境变量中的 AK、SK、SecurityToken。
- 不读取或打印 `secret.key`、`secrets.json`。
- 不绕过默认覆盖保护。
- 不把 `--all` 用于范围未知的大桶。
- 不把下载目标指向未经确认的已有本地文件。
- 本 CLI 不提供对象删除、桶删除或双向同步。
- 错误时保留 OBS request ID 供排障，但不要输出原始 SDK 请求或认证头。

## Skill 安装

先展示真实安装计划，再按用户要求安装：

```bash
agent-obs-cli install-skill --dry-run
agent-obs-cli install-skill
```

在非交互环境中，用户已明确授权后可使用 `--yes`。
