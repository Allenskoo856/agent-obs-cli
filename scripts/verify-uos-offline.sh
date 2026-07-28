#!/usr/bin/env bash

set -Eeuo pipefail

media_dir="${1:-/media}"
archive_path="$(find "${media_dir}" -maxdepth 1 -type f \
  -name 'agent-obs-cli-*-uos1050-linux-x64.tar.gz' -print -quit)"

[[ -n "${archive_path}" ]] || {
  printf 'error: offline archive was not found in %s\n' "${media_dir}" >&2
  exit 1
}

cd "${media_dir}"
sha256sum --check --quiet "$(basename -- "${archive_path}").sha256"

work_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "${work_dir}"
}
trap cleanup EXIT

tar -xzf "${archive_path}" -C "${work_dir}"
package_dir="$(find "${work_dir}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[[ -n "${package_dir}" ]] || {
  printf 'error: extracted package directory was not found\n' >&2
  exit 1
}

"${package_dir}/install.sh" \
  --prefix /opt/agent-obs-cli \
  --bin-dir /usr/local/bin \
  --yes

printf '\nRuntime compatibility:\n'
/opt/agent-obs-cli/runtime/node/bin/node --version
ldd /opt/agent-obs-cli/runtime/node/bin/node

printf '\nCLI smoke tests:\n'
agent-obs-cli --version
agent-obs-cli --config /opt/agent-obs-cli/app/config/example.json list
agent-obs-cli install-skill --dry-run

printf '\nOffline installation smoke test passed with Docker network disabled.\n'
