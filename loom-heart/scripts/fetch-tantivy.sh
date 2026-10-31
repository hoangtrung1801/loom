#!/usr/bin/env bash
# Downloads one prebuilt tantivy-go static library into deps/libs/<platform>/ and
# verifies it against tantivity_sha256.txt.
#
# `make check-tantivy-version` does the same for every platform, but it needs GNU
# make 4 and fetches ~12 archives; CI jobs that build for one platform (macOS and
# Windows runners) only need their own, so they call this instead.
#
# Usage (from loom-heart/): scripts/fetch-tantivy.sh <platform>
#   platform: darwin-amd64 | darwin-arm64 | windows-amd64 | linux-amd64-musl | linux-arm64-musl | ...
#             (any archive name from makefiles/tantivy.mk without .tar.gz)
set -euo pipefail

platform="${1:?usage: fetch-tantivy.sh <platform>}"
cd "$(dirname "$0")/.."

version="$(grep 'github.com/anyproto/tantivy-go ' go.mod | awk '{print $2}' || true)"
if [[ -z "$version" ]]; then
	echo "fetch-tantivy: tantivy-go is not in go.mod" >&2
	exit 1
fi

archive="${platform}.tar.gz"
expected="$(grep " deps/libs/${archive}\$" tantivity_sha256.txt | awk '{print $1}' || true)"
if [[ -z "$expected" ]]; then
	echo "fetch-tantivy: no checksum for ${archive} in tantivity_sha256.txt" >&2
	exit 1
fi

dest="deps/libs/${platform}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

curl --fail --silent --show-error --location --retry 3 \
	-o "$tmp" "https://github.com/anyproto/tantivy-go/releases/download/${version}/${archive}"

if command -v sha256sum >/dev/null 2>&1; then
	actual="$(sha256sum "$tmp" | awk '{print $1}')"
else
	actual="$(shasum -a 256 "$tmp" | awk '{print $1}')"
fi
if [[ "$actual" != "$expected" ]]; then
	echo "fetch-tantivy: checksum mismatch for ${archive}: got ${actual}, want ${expected}" >&2
	exit 1
fi

rm -rf "$dest"
mkdir -p "$dest"
tar -C "$dest" -xzf "$tmp"
echo "fetch-tantivy: ${archive} ${version} -> ${dest}"
