#!/usr/bin/env bash
# Copies native .node files next to the pkg binary so they can be loaded at runtime.
# pkg bundles JS but native .node files must sit alongside the binary.
#
# Usage: pkg-fix.sh <binary-path> <platform>
#   platform: linux | win

set -euo pipefail

BINARY="${1:-release/hippocampus-server-linux}"
PLATFORM="${2:-linux}"
BINARY_DIR="$(dirname "$BINARY")"

log() { echo -e "\033[0;34m▶\033[0m $*"; }
ok()  { echo -e "\033[0;32m✓\033[0m $*"; }

log "Copying native modules next to $(basename "$BINARY")..."

# ── Proto definition ──────────────────────────────────────────────────────────
if [ -f "src/proto/hippocampus.proto" ]; then
  cp src/proto/hippocampus.proto "$BINARY_DIR/"
  ok "hippocampus.proto copied"
fi

# ── better-sqlite3 ────────────────────────────────────────────────────────────
SQLITE_BUILD="node_modules/better-sqlite3/build/Release"
if [ -d "$SQLITE_BUILD" ]; then
  mkdir -p "$BINARY_DIR/better-sqlite3/build/Release"
  cp "$SQLITE_BUILD"/*.node "$BINARY_DIR/better-sqlite3/build/Release/"
  ok "better-sqlite3 native module copied"
else
  echo "⚠ better-sqlite3 build dir not found: $SQLITE_BUILD"
fi

# ── onnxruntime-node (used by @xenova/transformers) ───────────────────────────
if [ "$PLATFORM" = "win" ]; then
  ONNX_BUILD="node_modules/onnxruntime-node/bin/napi-v3/win32/x64"
  ONNX_DEST="$BINARY_DIR/onnxruntime-node/bin/napi-v3/win32/x64"
else
  ONNX_BUILD="node_modules/onnxruntime-node/bin/napi-v3/linux/x64"
  ONNX_DEST="$BINARY_DIR/onnxruntime-node/bin/napi-v3/linux/x64"
fi
if [ -d "$ONNX_BUILD" ]; then
  mkdir -p "$ONNX_DEST"
  cp "$ONNX_BUILD"/*.node "$ONNX_DEST/"
  ok "onnxruntime-node native module copied"
else
  echo "⚠ onnxruntime-node build dir not found: $ONNX_BUILD"
fi

# ── @tensorflow/tfjs-node ─────────────────────────────────────────────────────
TFJS_BUILD="node_modules/@tensorflow/tfjs-node/lib/napi-v8"
if [ -d "$TFJS_BUILD" ]; then
  mkdir -p "$BINARY_DIR/@tensorflow/tfjs-node/lib/napi-v8"
  cp "$TFJS_BUILD"/*.node "$BINARY_DIR/@tensorflow/tfjs-node/lib/napi-v8/"
  ok "@tensorflow/tfjs-node native module copied"
else
  echo "⚠ tfjs-node build dir not found: $TFJS_BUILD (skipping)"
fi

# ── TensorFlow shared libraries ───────────────────────────────────────────────
TFJS_DEPS="node_modules/@tensorflow/tfjs-node/deps/lib"
if [ -d "$TFJS_DEPS" ]; then
  cp "$TFJS_DEPS"/libtensorflow.so.2* "$BINARY_DIR/" 2>/dev/null || true
  cp "$TFJS_DEPS"/libtensorflow_framework.so.2* "$BINARY_DIR/" 2>/dev/null || true
  ok "TensorFlow shared libraries copied"
else
  echo "⚠ tfjs-node deps/lib not found: $TFJS_DEPS (skipping)"
fi


# ── @xenova/transformers ESM layout ──────────────────────────────────────────
# This package is pure ESM ("type":"module"). Node's ESM resolver inside a pkg
# binary can't serve file:// requests from the snapshot, so we copy the source
# files to the real filesystem next to the binary. embed/index.ts detects
# process.pkg and loads via a file:// URL pointing here.
XENOVA_DEST="$BINARY_DIR/node_modules/@xenova/transformers"
mkdir -p "$XENOVA_DEST"
cp -r node_modules/@xenova/transformers/src "$XENOVA_DEST/"
cp    node_modules/@xenova/transformers/package.json "$XENOVA_DEST/"
ok "@xenova/transformers source copied"

# onnxruntime-node JS wrapper + binding (imported by @xenova/transformers)
ONNX_NODE_DEST="$BINARY_DIR/node_modules/onnxruntime-node"
if [ -d "node_modules/onnxruntime-node" ]; then
  mkdir -p "$ONNX_NODE_DEST"
  cp    node_modules/onnxruntime-node/package.json "$ONNX_NODE_DEST/"
  cp -r node_modules/onnxruntime-node/dist "$ONNX_NODE_DEST/"
  # Re-use the .node file already staged by the onnxruntime-node step above
  mkdir -p "$ONNX_NODE_DEST/bin/napi-v3/linux/x64"
  cp "$BINARY_DIR/onnxruntime-node/bin/napi-v3/linux/x64/"*.node \
     "$ONNX_NODE_DEST/bin/napi-v3/linux/x64/" 2>/dev/null || true
  ok "onnxruntime-node (ESM layout) set up"
fi

# onnxruntime-common (shared types; required by both onnxruntime-node and -web)
if [ -d "node_modules/onnxruntime-common" ]; then
  cp -r node_modules/onnxruntime-common "$BINARY_DIR/node_modules/"
  ok "onnxruntime-common copied"
fi

# onnxruntime-web JS (imported statically by @xenova/transformers; WASM excluded)
if [ -d "node_modules/onnxruntime-web" ]; then
  ONNX_WEB_DEST="$BINARY_DIR/node_modules/onnxruntime-web"
  mkdir -p "$ONNX_WEB_DEST/dist"
  cp node_modules/onnxruntime-web/package.json "$ONNX_WEB_DEST/"
  find node_modules/onnxruntime-web/dist -name "*.js" \
    -exec cp {} "$ONNX_WEB_DEST/dist/" \;
  ok "onnxruntime-web JS copied (WASM excluded)"
fi

# @huggingface/jinja (template engine; required by @xenova/transformers)
if [ -d "node_modules/@huggingface/jinja" ]; then
  mkdir -p "$BINARY_DIR/node_modules/@huggingface"
  cp -r node_modules/@huggingface/jinja "$BINARY_DIR/node_modules/@huggingface/"
  ok "@huggingface/jinja copied"
fi

ok "Native modules ready in $BINARY_DIR/"
