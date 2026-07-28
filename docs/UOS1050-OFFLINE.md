# UOS 1050 / Debian 10 离线介质

仓库的 `Build UOS 1050 Offline Media` GitHub Actions 工作流会在每次向
`main` 推送代码后自动执行，也可以从 Actions 页面手动触发。

## 流水线做什么

1. 拉取官方 `debian:10` 容器。
2. 在 Debian 10 中下载并校验固定版本的 Linux x64 Node.js 运行时。
3. 先通过 Node.js 22 的类型检查、Lint、单元测试和构建质量门禁。
4. 在 Debian 10 中重新执行 `npm ci`、类型检查、Lint 和构建。
5. 重新安装 lockfile 锁定的生产依赖。
6. 将 Node.js、CLI、生产依赖、Agent Skill、示例配置和安装器打包。
7. 启动第二个 `--network none` 的 Debian 10 容器。
8. 校验 SHA256、执行系统级离线安装，并运行版本、配置和 Skill 冒烟测试。
9. 上传保留 30 天的 Actions Artifact。

目标产物包括：

```text
agent-obs-cli-v<version>-uos1050-linux-x64.tar.gz
agent-obs-cli-v<version>-uos1050-linux-x64.tar.gz.sha256
BUILD_INFO.txt
OFFLINE_SMOKE_TEST.txt
```

## 下载与转运

在 GitHub 仓库的 Actions 页面打开成功的 `Build UOS 1050 Offline Media`
任务，从 Artifacts 下载 ZIP。解压 ZIP 后，把 `.tar.gz` 和 `.sha256`
一起转移到内网。

## 内网安装

目标机不需要预装 Node.js、npm，也不需要访问 npm 或 GitHub。

```bash
sha256sum -c agent-obs-cli-*-uos1050-linux-x64.tar.gz.sha256
tar -xzf agent-obs-cli-*-uos1050-linux-x64.tar.gz
cd agent-obs-cli-*-uos1050-linux-x64
sudo ./install.sh --yes
agent-obs-cli --version
```

详细配置和普通用户安装方式见压缩包内的 `README-OFFLINE.md`。

## 兼容范围

- UOS 1050 / Debian 10 兼容 Linux
- x86_64 / amd64
- 构建与验证环境均为 Debian 10
- 安装验证容器使用 `--network none`
- 实际读写 OBS 时，机器仍需能访问配置中的华为云 OBS Endpoint

ARM64 不是该介质的目标架构，需单独增加对应运行时和验证任务。
