#!/usr/bin/env bash
# Prepares a fresh Linux x64 container (e.g. a Claude Code cloud session) to run Loom in web mode.
# Builds the bundled loom-heart middleware from source instead of downloading prebuilt
# binaries (update.sh pulls from anyproto/anytype-heart, which may be blocked).
#
# Usage: bash scripts/setup-cloud.sh && bun run start:web
# Needs: go, bun, node, curl, python3, and network access to github.com + the Go module proxy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HEART="$ROOT/loom-heart"
PLUG="${TMPDIR:-/tmp}/loom-protoc-plugins"
GRPC_WEB_VERSION=1.5.0
PROTOBUF_JS_VERSION=3.21.4

cd "$ROOT"

# 1. JS dependencies. --ignore-scripts skips the electron native rebuild (keytar needs libsecret),
#    which web mode does not need.
bun install --ignore-scripts
bunx patch-package

# 2. protoc
if ! command -v protoc >/dev/null; then
	(apt-get update -qq && apt-get install -y -qq protobuf-compiler) || {
		echo "Install protoc manually"; exit 1; }
fi

# 3. Tantivy static lib (normally fetched by make check-tantivy-version)
TV="$(grep github.com/anyproto/tantivy-go "$HEART/go.mod" | awk '{print $2}')"
TDIR="$HEART/deps/libs/linux-amd64-musl"
if [[ ! -f "$TDIR/libtantivy_go.a" ]]; then
	mkdir -p "$TDIR"
	curl -fsSL -o "$PLUG.tantivy.tgz" "https://github.com/anyproto/tantivy-go/releases/download/$TV/linux-amd64-musl.tar.gz"
	tar -C "$TDIR" -xzf "$PLUG.tantivy.tgz"
fi

# 4. Build the middleware (takes a few minutes on a cold Go cache)
mkdir -p "$HEART/dist" "$ROOT/dist/lib/json/generated"
(cd "$HEART" && go build -o dist/server --tags "nosigar nowatchdog" github.com/hoangtrung1801/loom/loom-heart/cmd/grpcserver)
cp "$HEART/dist/server" "$ROOT/dist/loomHelper"
cp "$HEART"/pkg/lib/bundle/system*.json "$HEART"/pkg/lib/bundle/internal*.json "$ROOT/dist/lib/json/generated/"

# 5. TypeScript bindings (middleware/) used by the app
SKIP_HEART_BUILD=1 bash scripts/generate-protos.sh

# 6. JS bindings (dist/lib/pb) used by vite. The npm plugin packages download their binaries
#    in a postinstall step that ignores the proxy, so fetch them directly.
mkdir -p "$PLUG"
if [[ ! -x "$PLUG/protoc-gen-grpc-web" ]]; then
	curl -fsSL -o "$PLUG/protoc-gen-grpc-web" "https://github.com/grpc/grpc-web/releases/download/$GRPC_WEB_VERSION/protoc-gen-grpc-web-$GRPC_WEB_VERSION-linux-x86_64"
	chmod +x "$PLUG/protoc-gen-grpc-web"
fi
if [[ ! -x "$PLUG/protoc-gen-js" ]]; then
	curl -fsSL -o "$PLUG/pgjs.zip" "https://github.com/protocolbuffers/protobuf-javascript/releases/download/v$PROTOBUF_JS_VERSION/protobuf-javascript-$PROTOBUF_JS_VERSION-linux-x86_64.zip"
	python3 -I -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extract('bin/protoc-gen-js', sys.argv[2])" "$PLUG/pgjs.zip" "$PLUG/x"
	mv "$PLUG/x/bin/protoc-gen-js" "$PLUG/protoc-gen-js" && chmod +x "$PLUG/protoc-gen-js"
fi
(
	cd "$HEART"
	export PATH="$PLUG:$PATH"
	mkdir -p dist/js/pb
	FILES="pb/protos/service/*.proto pb/protos/*.proto pkg/lib/pb/model/protos/*.proto"
	protoc -I ./ --js_out=import_style=commonjs,binary:./dist/js/pb $FILES
	protoc -I ./ --grpc-web_out=import_style=commonjs+dts,mode=grpcwebtext:./dist/js/pb $FILES
	cp -r dist/js/pb/* "$ROOT/dist/lib"
)

echo "Done. Start with: bun run start:web   (open http://127.0.0.1:3030/ with the printed ?server=... URL)"
