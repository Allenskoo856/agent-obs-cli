#!/usr/bin/env bash

set -Eeuo pipefail

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

[[ "$(uname -s)" == "Linux" ]] || fail "run this script inside a Linux container"
case "$(uname -m)" in
  x86_64|amd64) ;;
  *) fail "only Linux x86_64 is supported" ;;
esac
[[ "${EUID}" -eq 0 ]] || fail "run this script as root inside the build container"

root_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
node_version="${NODE_VERSION:-22.23.1}"
node_archive="node-v${node_version}-linux-x64.tar.xz"
node_base_url="https://nodejs.org/dist/v${node_version}"
output_dir="${root_dir}/dist/uos-offline"
build_root="$(mktemp -d)"

cleanup() {
  rm -rf -- "${build_root}"
}
trap cleanup EXIT

printf 'Configuring archived Debian 10 repositories...\n'
cat > /etc/apt/sources.list <<'EOF'
deb http://archive.debian.org/debian buster main
deb http://archive.debian.org/debian-security buster/updates main
deb http://archive.debian.org/debian buster-updates main
EOF

apt-get -o Acquire::Check-Valid-Until=false update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  ca-certificates \
  coreutils \
  curl \
  findutils \
  gzip \
  tar \
  xz-utils
rm -rf /var/lib/apt/lists/*

printf 'Downloading and verifying Node.js %s...\n' "${node_version}"
curl --fail --location --retry 3 \
  --output "${build_root}/${node_archive}" \
  "${node_base_url}/${node_archive}"
curl --fail --location --retry 3 \
  --output "${build_root}/SHASUMS256.txt" \
  "${node_base_url}/SHASUMS256.txt"
(
  cd "${build_root}"
  grep " ${node_archive}\$" SHASUMS256.txt > NODE_CHECKSUM
  [[ -s NODE_CHECKSUM ]] || fail "Node.js checksum entry was not found"
  sha256sum --check NODE_CHECKSUM
)

tar -xJf "${build_root}/${node_archive}" -C "${build_root}"
node_home="${build_root}/node-v${node_version}-linux-x64"
export PATH="${node_home}/bin:${PATH}"

printf 'Using %s and %s\n' "$(node --version)" "$(npm --version)"
cd "${root_dir}"
npm ci
npm run check
npm run lint
npm run build

printf 'Installing production-only dependencies for the medium...\n'
npm ci --omit=dev --ignore-scripts

package_version="$(node -p "require('./package.json').version")"
media_name="agent-obs-cli-v${package_version}-uos1050-linux-x64"
media_dir="${build_root}/${media_name}"
archive_name="${media_name}.tar.gz"

rm -rf -- "${output_dir}"
mkdir -p \
  "${output_dir}" \
  "${media_dir}/runtime/node" \
  "${media_dir}/app"

cp -a -- "${node_home}/." "${media_dir}/runtime/node/"
cp -a -- \
  "${root_dir}/bin" \
  "${root_dir}/config" \
  "${root_dir}/dist" \
  "${root_dir}/node_modules" \
  "${root_dir}/skills" \
  "${media_dir}/app/"
cp -a -- \
  "${root_dir}/package.json" \
  "${root_dir}/package-lock.json" \
  "${root_dir}/README.md" \
  "${root_dir}/README_EN.md" \
  "${root_dir}/AI_INSTALL.md" \
  "${root_dir}/LICENSE" \
  "${media_dir}/app/"
install -m 0755 \
  "${root_dir}/packaging/offline/install.sh" \
  "${media_dir}/install.sh"
install -m 0755 \
  "${root_dir}/packaging/offline/launcher.sh" \
  "${media_dir}/launcher.sh"
install -m 0644 \
  "${root_dir}/packaging/offline/README-OFFLINE.md" \
  "${media_dir}/README-OFFLINE.md"

build_time="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
commit_sha="${GITHUB_SHA:-unknown}"
cat > "${media_dir}/BUILD_INFO.txt" <<EOF
project=agent-obs-cli
project_version=${package_version}
node_version=${node_version}
target_os=UOS 1050 / Debian 10
target_arch=linux-x64
commit=${commit_sha}
built_at=${build_time}
EOF

printf 'Creating payload checksums...\n'
(
  cd "${media_dir}"
  find . -type f ! -name SHA256SUMS -print0 |
    sort -z |
    xargs -0 sha256sum > SHA256SUMS
)

printf 'Creating %s...\n' "${archive_name}"
tar \
  --sort=name \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  -czf "${output_dir}/${archive_name}" \
  -C "${build_root}" \
  "${media_name}"
(
  cd "${output_dir}"
  sha256sum "${archive_name}" > "${archive_name}.sha256"
)
cp -a -- "${media_dir}/BUILD_INFO.txt" "${output_dir}/BUILD_INFO.txt"

if [[ "${HOST_UID:-}" =~ ^[0-9]+$ && "${HOST_GID:-}" =~ ^[0-9]+$ ]]; then
  chown -R -- "${HOST_UID}:${HOST_GID}" \
    "${root_dir}/node_modules" \
    "${root_dir}/dist"
fi

printf '\nOffline medium created:\n'
find "${output_dir}" -maxdepth 1 -type f -printf '  %f (%s bytes)\n' | sort
