# AI 安装说明

请先确认 Node.js 版本：

```bash
node --version
npm --version
```

Node.js 必须使用 `20.19+`、`22.13+` 或 `24+`，推荐使用 LTS 版本。

## 源码安装

```bash
git clone https://github.com/Allenskoo856/agent-obs-cli.git
cd agent-obs-cli
npm install
npm run check
npm test
npm run build
npm link
agent-obs-cli --help
```

不要替用户创建真实 AK/SK，也不要把真实凭据写进仓库。复制 `config/example.json` 到：

```text
~/.agent-obs-cli/config.json
```

优先使用 `source: "env"`，让配置只保存环境变量名称。永久 AK/SK 不配置 `securityTokenEnv`；临时 AK/SK 必须同时配置 SecurityToken。

## 安装 Skill

先展示安装计划：

```bash
agent-obs-cli install-skill --dry-run
```

用户确认后执行：

```bash
agent-obs-cli install-skill
```

非交互环境且用户已经明确授权时：

```bash
agent-obs-cli install-skill --yes
```

## 验证

```bash
agent-obs-cli list
agent-obs-cli test --bucket "<configured-bucket-alias>"
```

不要读取或输出 `secret.key`、`secrets.json` 或环境变量中的凭据。执行上传前先展示目标桶、对象 key、源文件以及覆盖策略；批量上传必须先运行 `--dry-run`。
