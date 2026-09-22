#!/usr/bin/env bash
set -euo pipefail

repo_owner="effortprogrammer"
repo_name="geojirouter"
repo_ref="${GATEWAY_REPO_REF:-main}"
install_root="${GATEWAY_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/everyone-gateway}"
bin_dir="${GATEWAY_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"

if ! command -v curl >/dev/null 2>&1; then
  printf '%s\n' "curl is required to install geojirouter." >&2
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  printf '%s\n' "tar is required to install geojirouter." >&2
  exit 1
fi

bun_bin="$(command -v bun || true)"
if [[ -z "$bun_bin" ]]; then
  printf '%s\n' "Bun was not found. Installing it in $HOME/.bun..."
  curl -fsSL https://bun.sh/install | bash
  bun_bin="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
fi

if [[ ! -x "$bun_bin" ]]; then
  printf '%s\n' "Bun was not found at $bun_bin after installation." >&2
  exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/everyone-gateway.XXXXXX")"
staging_dir="${install_root}.tmp.$$"
cleanup() {
  rm -rf "$tmp_dir" "$staging_dir"
}
trap cleanup EXIT

source_dir="$tmp_dir/$repo_name"
archive_url="https://github.com/$repo_owner/$repo_name/archive/refs/heads/$repo_ref.tar.gz"
mkdir -p "$source_dir"
curl -fsSL "$archive_url" | tar -xz -C "$source_dir" --strip-components=1

(
  cd "$source_dir"
  "$bun_bin" install --no-save
  "$bun_bin" run build
)

mkdir -p "$(dirname "$install_root")" "$bin_dir"
rm -rf "$staging_dir"
mkdir -p "$staging_dir/dist"
cp "$source_dir/dist/cli.js" "$staging_dir/dist/cli.js"
rm -rf "$install_root"
mv "$staging_dir" "$install_root"
ln -sfn "$install_root/dist/cli.js" "$bin_dir/gateway"

printf '\n%s\n' "geojirouter installed: $bin_dir/gateway"
if [[ ":${PATH:-}:" != *":$bin_dir:"* ]]; then
  printf '%s\n' "Add this directory to PATH before running gateway:"
  printf '  export PATH="%s:$PATH"\n' "$bin_dir"
fi
printf '%s\n' "Try: gateway --help"
