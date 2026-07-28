<div align="center">

# agent-obs-cli

面向 Agent 的华为云 OBS 命令行工具。

桶配置解析 · 对象查询 · 断点续传下载 · 单文件上传 · 递归批量上传 · 多账号与多桶 · Agent Skill

</div>

## 功能

- 使用桶别名或唯一真实桶名自动定位 profile、Endpoint 和凭据
- 查询桶元数据、列举桶内对象、查询对象元数据
- 下载对象到本地，默认拒绝覆盖已有文件
- 上传单个文件，默认拒绝覆盖已有对象
- 递归批量上传目录，支持 dry-run、并发限制和逐项结果
- 支持多账号、多区域、多桶配置
- 支持永久 AK/SK 和临时 AK/SK/SecurityToken
- 支持环境变量凭据或仅本机可解密的本地密文
- 内置可安装的 Agent skill
- 默认 JSON 输出，也支持 table 输出

本项目使用华为云官方 Node.js SDK `esdk-obs-nodejs`。相关官方文档：

- [安装 OBS Node.js SDK](https://support.huaweicloud.com/sdk-nodejs-devg-obs/obs_29_0105.html)
- [创建 OBS 客户端](https://support.huaweicloud.com/sdk-nodejs-devg-obs/obs_29_0202.html)
- [列举桶内对象](https://support.huaweicloud.com/sdk-nodejs-devg-obs/obs_29_0605.html)
- [断点续传上传](https://support.huaweicloud.com/sdk-nodejs-devg-obs/obs_29_0411.html)

## 安装

环境要求：

- Node.js `20.19+`、`22.13+` 或 `24+`（推荐使用 LTS）
- npm `>= 10`
- 可访问目标 OBS Endpoint

源码安装：

```bash
git clone https://github.com/Allenskoo856/agent-obs-cli.git
cd agent-obs-cli
npm install
npm run build
npm link
agent-obs-cli --help
```

npm 包发布后可直接安装：

```bash
npm install -g agent-obs-cli
agent-obs-cli --help
```

### UOS 1050 / Debian 10 离线安装

每次向 `main` 推送代码后，GitHub Actions 会在 Debian 10 容器中构建
Linux x86_64 离线介质，并在禁用网络的第二个 Debian 10 容器中完成安装和
CLI 冒烟测试。介质自带 Node.js、生产依赖、CLI、Agent Skill、示例配置、
安装脚本和 SHA256 校验文件，目标机不需要预装 Node.js 或访问 npm。

从 Actions 的 `Build UOS 1050 Offline Media` 任务下载 Artifact，转移到
内网后执行：

```bash
sha256sum -c agent-obs-cli-*-uos1050-linux-x64.tar.gz.sha256
tar -xzf agent-obs-cli-*-uos1050-linux-x64.tar.gz
cd agent-obs-cli-*-uos1050-linux-x64
sudo ./install.sh --yes
agent-obs-cli --version
```

完整说明见 [`docs/UOS1050-OFFLINE.md`](docs/UOS1050-OFFLINE.md)。

## 配置

默认配置文件：

```text
~/.agent-obs-cli/config.json
```

也可通过环境变量或全局参数指定：

```bash
AGENT_OBS_CLI_CONFIG=/path/to/config.json agent-obs-cli list
agent-obs-cli --config /path/to/config.json list
```

完整示例见 [`config/example.json`](config/example.json)。

### 使用永久 AK/SK

配置文件只保存环境变量名称：

```json
{
  "profiles": {
    "prod-account": {
      "credentials": {
        "source": "env",
        "accessKeyIdEnv": "HUAWEI_OBS_PROD_AK",
        "secretAccessKeyEnv": "HUAWEI_OBS_PROD_SK"
      },
      "maxRetries": 3,
      "timeoutSeconds": 60
    }
  },
  "buckets": {
    "prod-assets": {
      "name": "actual-prod-assets-bucket",
      "profile": "prod-account",
      "endpoint": "https://obs.cn-north-4.myhuaweicloud.com"
    }
  }
}
```

运行前设置：

```bash
export HUAWEI_OBS_PROD_AK="your-access-key"
export HUAWEI_OBS_PROD_SK="your-secret-key"
```

### 使用临时凭据

临时 AK/SK 必须和 SecurityToken 成套使用：

```json
{
  "source": "env",
  "accessKeyIdEnv": "HUAWEI_OBS_TEMP_AK",
  "secretAccessKeyEnv": "HUAWEI_OBS_TEMP_SK",
  "securityTokenEnv": "HUAWEI_OBS_TEMP_TOKEN"
}
```

`securityTokenEnv` 是保存 Token 的环境变量名称，不是 Token 本身。永久 AK/SK 不需要该字段。

### 使用本地密文

也可以首次在 `source: "local"` 中填写凭据：

```json
{
  "source": "local",
  "accessKeyId": "your-access-key",
  "secretAccessKey": "your-secret-key"
}
```

首次使用该 profile 时，CLI 会将明文迁移到配置目录下的 `secrets.json`，使用 AES-256-GCM 加密，并生成权限为 `0600` 的 `secret.key`。配置文件改写为 `accessKeyIdRef`、`secretAccessKeyRef`，后续只在内存中解密。不要提交配置、`secrets.json` 或 `secret.key`。

### 多桶解析规则

`buckets` 的 key 是稳定别名。所有 `--bucket` 参数：

1. 优先精确匹配别名；
2. 否则匹配唯一真实桶名；
3. 无匹配时返回可用别名；
4. 多个配置使用同一真实桶名时，必须使用别名。

这样 Agent 只需知道桶名或别名，就能取得对应 profile、Endpoint 和凭据。

## 使用

列出配置：

```bash
agent-obs-cli list
agent-obs-cli --format table list
```

测试桶并查询桶信息：

```bash
agent-obs-cli test --bucket prod-assets
agent-obs-cli bucket-info --bucket actual-prod-assets-bucket
```

列举对象。OBS 单次最多返回 1000 条，结果包含 `nextMarker`：

```bash
agent-obs-cli list-objects --bucket prod-assets --prefix "logs/2026/"
agent-obs-cli list-objects --bucket prod-assets --marker "<nextMarker>"
agent-obs-cli list-objects --bucket prod-assets --prefix "small-prefix/" --all
```

查询对象元数据：

```bash
agent-obs-cli object-info \
  --bucket prod-assets \
  --key "reports/report.csv"
```

下载对象：

```bash
agent-obs-cli download \
  --bucket prod-assets \
  --key "reports/report.csv" \
  --output "./report.csv"
```

本地目标存在时默认失败。明确需要覆盖时添加 `--overwrite`。

上传文件：

```bash
agent-obs-cli upload \
  --bucket prod-assets \
  --file "./report.csv" \
  --key "reports/report.csv"
```

远端对象存在时默认失败。明确需要覆盖时添加 `--overwrite`。小于 100 KiB 的文件使用简单上传，其余文件使用带 checkpoint 的分段上传。

批量上传必须先 dry-run：

```bash
agent-obs-cli upload-batch \
  --bucket prod-assets \
  --source "./assets" \
  --prefix "assets/" \
  --dry-run
```

确认输出后执行：

```bash
agent-obs-cli upload-batch \
  --bucket prod-assets \
  --source "./assets" \
  --prefix "assets/" \
  --concurrency 4
```

批量上传递归包含隐藏的普通文件，不跟随符号链接。冲突对象默认跳过；单项失败后继续处理其余文件，最终返回非零退出码和逐项状态。

## Agent Skill

查看安装计划：

```bash
agent-obs-cli install-skill --dry-run
```

安装：

```bash
agent-obs-cli install-skill
```

主目录为 `~/.agents/skills/agent-obs-cli`。CLI 会为已经存在的 Codex、Claude、OpenCode、Cursor、Gemini 等 skill 父目录创建软链接；已有非软链接目标不会被覆盖。

## 安全边界

- 不支持对象删除、桶删除和双向同步
- Endpoint 必须是 HTTPS 域名
- 不在 stdout、stderr 或表格中输出凭据
- 上传和下载默认拒绝覆盖
- `list-objects --all` 只应对范围明确的前缀使用
- checkpoint 默认存放在 `~/.agent-obs-cli/checkpoints/`

## 开发

```bash
npm install
npm run check
npm run lint
npm test
npm run build
npm run pack:check
```

真实 OBS 集成测试需要单独提供测试账号和一次性测试前缀；默认测试不会访问云资源。

## License

MIT
