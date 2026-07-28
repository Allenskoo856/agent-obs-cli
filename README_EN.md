<div align="center">

# agent-obs-cli

An Agent-friendly CLI for Huawei Cloud OBS.

Bucket resolution · Object queries · Resumable download · Upload · Recursive batch upload · Multiple accounts and buckets · Agent Skill

</div>

## Features

- Resolve a configured profile, endpoint, and credentials from a bucket alias or unique real bucket name
- Inspect bucket metadata, list objects, and inspect object metadata
- Download objects with resumable checkpoints
- Upload one file or recursively upload a directory
- Refuse remote and local overwrites by default
- Support multiple accounts, regions, endpoints, and buckets
- Support permanent AK/SK or temporary AK/SK/SecurityToken
- Read credentials from environment variables or locally encrypted storage
- Install a bundled Agent skill
- Emit JSON by default, with optional table output

This project uses Huawei Cloud's official `esdk-obs-nodejs` SDK. See the official documentation for [SDK installation](https://support.huaweicloud.com/sdk-nodejs-devg-obs/obs_29_0105.html), [client initialization](https://support.huaweicloud.com/sdk-nodejs-devg-obs/obs_29_0202.html), [listing objects](https://support.huaweicloud.com/sdk-nodejs-devg-obs/obs_29_0605.html), and [resumable uploads](https://support.huaweicloud.com/sdk-nodejs-devg-obs/obs_29_0411.html).

## Installation

Requirements: Node.js `20.19+`, `22.13+`, or `24+` (use an LTS release), npm `>= 10`, and network access to the configured OBS endpoints.

```bash
git clone https://github.com/Allenskoo856/agent-obs-cli.git
cd agent-obs-cli
npm install
npm run build
npm link
agent-obs-cli --help
```

After the npm package is published:

```bash
npm install -g agent-obs-cli
```

### Offline installation on UOS 1050 / Debian 10

Every push to `main` builds a Linux x86_64 offline medium inside Debian 10 and
installs it in a second Debian 10 container with networking disabled. The
archive bundles Node.js, production dependencies, the CLI, Agent Skill, example
configuration, installer, and SHA256 checksums.

Download the artifact from the `Build UOS 1050 Offline Media` Actions workflow,
transfer the archive and checksum to the isolated network, then run:

```bash
sha256sum -c agent-obs-cli-*-uos1050-linux-x64.tar.gz.sha256
tar -xzf agent-obs-cli-*-uos1050-linux-x64.tar.gz
cd agent-obs-cli-*-uos1050-linux-x64
sudo ./install.sh --yes
agent-obs-cli --version
```

See [`docs/UOS1050-OFFLINE.md`](docs/UOS1050-OFFLINE.md) for the full workflow
and compatibility boundary.

## Configuration

The default configuration path is `~/.agent-obs-cli/config.json`. Override it with `AGENT_OBS_CLI_CONFIG` or global `--config <path>`. See [`config/example.json`](config/example.json).

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
  },
  "defaults": {
    "concurrency": 4,
    "partSizeBytes": 9437184
  }
}
```

For temporary credentials, add `securityTokenEnv`; it names the environment variable containing the temporary SecurityToken. Omit it for permanent AK/SK credentials.

For local encrypted credentials, set `source` to `local` and initially provide `accessKeyId`, `secretAccessKey`, and optional `securityToken`. On first use, the CLI encrypts them into `secrets.json` with a local `secret.key`, then rewrites the config to use `*Ref` fields.

Every `--bucket` first matches an alias, then a unique real bucket name. Ambiguous real names must use an alias.

## Commands

```bash
agent-obs-cli list
agent-obs-cli test --bucket prod-assets
agent-obs-cli bucket-info --bucket prod-assets
agent-obs-cli list-objects --bucket prod-assets --prefix "logs/"
agent-obs-cli object-info --bucket prod-assets --key "logs/a.json"
agent-obs-cli download --bucket prod-assets --key "a.bin" --output "./a.bin"
agent-obs-cli upload --bucket prod-assets --file "./a.bin" --key "a.bin"
agent-obs-cli upload-batch --bucket prod-assets --source "./assets" --prefix "assets/" --dry-run
```

`list-objects` returns up to 1,000 objects by default and includes a continuation marker. Use `--all` only for a known, bounded prefix.

Uploads and downloads refuse overwrites unless `--overwrite` is explicitly passed. Always run batch uploads with `--dry-run` first. Directory traversal includes regular files and skips symbolic links.

## Agent Skill

```bash
agent-obs-cli install-skill --dry-run
agent-obs-cli install-skill
```

The canonical skill is installed under `~/.agents/skills/agent-obs-cli`; symlinks are created only for Agent skill parent directories that already exist. Existing non-symlink targets are preserved.

## Development

```bash
npm install
npm run check
npm run lint
npm test
npm run build
npm run pack:check
```

The default test suite never accesses live cloud resources.

## License

MIT
