# agent-obs-cli UOS 1050 / Debian 10 离线安装介质

该介质面向 Linux x86_64，内含固定版本的 Node.js 运行时、生产依赖、CLI、
Agent Skill 和示例配置。安装过程不会访问网络。

## 校验介质

把 `.tar.gz` 和同名 `.sha256` 文件复制到内网机器后执行：

```bash
sha256sum -c agent-obs-cli-*-uos1050-linux-x64.tar.gz.sha256
tar -xzf agent-obs-cli-*-uos1050-linux-x64.tar.gz
cd agent-obs-cli-*-uos1050-linux-x64
```

## 系统级安装

```bash
sudo ./install.sh --yes
/usr/local/bin/agent-obs-cli --version
```

默认安装到 `/opt/agent-obs-cli`，命令链接放到 `/usr/local/bin`。

## 普通用户安装

```bash
./install.sh --yes
export PATH="$HOME/.local/bin:$PATH"
agent-obs-cli --version
```

默认安装到 `~/.local/share/agent-obs-cli`。

也可以明确指定路径：

```bash
./install.sh \
  --prefix /data/apps/agent-obs-cli \
  --bin-dir /data/bin \
  --yes
```

目标安装目录或命令路径已经存在时，安装器会拒绝覆盖。请先确认旧安装，
再手动迁移或删除。

## 配置 OBS

系统级安装的示例配置位于：

```text
/opt/agent-obs-cli/app/config/example.json
```

复制后修改桶、Endpoint 和环境变量名称：

```bash
mkdir -p ~/.agent-obs-cli
cp /opt/agent-obs-cli/app/config/example.json ~/.agent-obs-cli/config.json
chmod 600 ~/.agent-obs-cli/config.json
```

设置 AK/SK 等环境变量后验证：

```bash
agent-obs-cli list
agent-obs-cli test --bucket <桶别名>
```

安装随介质提供的 Agent Skill：

```bash
agent-obs-cli install-skill --dry-run
agent-obs-cli install-skill --yes
```

## 兼容性边界

- 目标系统：UOS 1050 / Debian 10 兼容环境
- 架构：Linux x86_64
- 不要求目标机预装 Node.js 或 npm
- 安装阶段完全离线；实际 OBS 操作仍需目标机能访问相应 OBS Endpoint
