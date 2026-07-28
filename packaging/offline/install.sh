#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Install agent-obs-cli without accessing the network.

Usage:
  ./install.sh [--prefix <path>] [--bin-dir <path>] [--yes]

Options:
  --prefix <path>   Installation directory.
                    root default: /opt/agent-obs-cli
                    user default: ~/.local/share/agent-obs-cli
  --bin-dir <path>  Directory for the agent-obs-cli command.
                    root default: /usr/local/bin
                    user default: ~/.local/bin
  --yes             Skip the confirmation prompt.
  -h, --help        Show this help.
EOF
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

if [[ "${EUID}" -eq 0 ]]; then
  prefix="/opt/agent-obs-cli"
  bin_dir="/usr/local/bin"
else
  prefix="${HOME}/.local/share/agent-obs-cli"
  bin_dir="${HOME}/.local/bin"
fi

assume_yes=false

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --prefix)
      [[ "$#" -ge 2 ]] || fail "--prefix requires a path"
      prefix="$2"
      shift 2
      ;;
    --bin-dir)
      [[ "$#" -ge 2 ]] || fail "--bin-dir requires a path"
      bin_dir="$2"
      shift 2
      ;;
    --yes)
      assume_yes=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ "${prefix}" = /* ]] || fail "--prefix must be an absolute path"
[[ "${bin_dir}" = /* ]] || fail "--bin-dir must be an absolute path"

case "${prefix}" in
  /|/usr|/usr/local|/opt|/home|/root)
    fail "refusing unsafe installation prefix: ${prefix}"
    ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ;;
  *) fail "this medium only supports Linux x86_64" ;;
esac

for command_name in sha256sum cp dirname install ln mkdir mv readlink rm uname; do
  command -v "${command_name}" >/dev/null 2>&1 ||
    fail "required command is missing: ${command_name}"
done

media_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "${media_dir}/SHA256SUMS" ]] || fail "SHA256SUMS is missing"
[[ -d "${media_dir}/runtime/node" ]] || fail "bundled Node.js runtime is missing"
[[ -d "${media_dir}/app" ]] || fail "application payload is missing"
[[ -f "${media_dir}/launcher.sh" ]] || fail "launcher.sh is missing"

printf 'Verifying offline medium checksums...\n'
(
  cd "${media_dir}"
  sha256sum --check --quiet --strict SHA256SUMS
)

command_path="${bin_dir}/agent-obs-cli"
[[ ! -e "${prefix}" && ! -L "${prefix}" ]] ||
  fail "installation prefix already exists: ${prefix}"
[[ ! -e "${command_path}" && ! -L "${command_path}" ]] ||
  fail "command path already exists: ${command_path}"

printf '\nInstallation plan:\n'
printf '  application: %s\n' "${prefix}"
printf '  command:     %s\n' "${command_path}"
printf '  network:     not used\n'

if [[ "${assume_yes}" != true ]]; then
  if [[ ! -t 0 ]]; then
    fail "non-interactive installation requires --yes"
  fi
  read -r -p "Continue? [y/N] " answer
  case "${answer}" in
    y|Y|yes|YES) ;;
    *) printf 'Installation cancelled.\n'; exit 1 ;;
  esac
fi

parent_dir="$(dirname -- "${prefix}")"
stage_dir="${parent_dir}/.agent-obs-cli.install.$$"

cleanup() {
  if [[ -d "${stage_dir}" ]]; then
    rm -rf -- "${stage_dir}"
  fi
}
trap cleanup EXIT

mkdir -p -- "${parent_dir}" "${bin_dir}" "${stage_dir}/bin"
cp -a -- "${media_dir}/runtime" "${stage_dir}/runtime"
cp -a -- "${media_dir}/app" "${stage_dir}/app"
install -m 0755 -- "${media_dir}/launcher.sh" "${stage_dir}/bin/agent-obs-cli"
mv -- "${stage_dir}" "${prefix}"
ln -s -- "${prefix}/bin/agent-obs-cli" "${command_path}"
trap - EXIT

printf '\nInstalled successfully.\n'
"${command_path}" --version
printf '\nNext steps:\n'
printf '  1. Copy %s/app/config/example.json to ~/.agent-obs-cli/config.json and edit it.\n' "${prefix}"
printf '  2. Export the configured OBS credential environment variables.\n'
printf '  3. Run: agent-obs-cli install-skill --yes\n'

if [[ ":${PATH}:" != *":${bin_dir}:"* ]]; then
  printf '  4. Add %s to PATH.\n' "${bin_dir}"
fi
