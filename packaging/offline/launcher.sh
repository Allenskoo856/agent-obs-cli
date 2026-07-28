#!/usr/bin/env bash

set -Eeuo pipefail

self_path="$(readlink -f -- "$0")"
install_root="$(CDPATH= cd -- "$(dirname -- "${self_path}")/.." && pwd)"

exec \
  "${install_root}/runtime/node/bin/node" \
  "${install_root}/app/bin/agent-obs-cli.js" \
  "$@"
