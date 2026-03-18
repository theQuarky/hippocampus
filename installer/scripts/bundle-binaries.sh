#!/usr/bin/env bash
# Downloads Qdrant and Ollama binaries for bundling into the Electron installer.
# Usage: bundle-binaries.sh [linux|windows|macos]
set -euo pipefail

PLATFORM="${1:-linux}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/binaries/$PLATFORM"
mkdir -p "$OUT"

QDRANT_VERSION="1.9.2"
OLLAMA_VERSION="0.3.6"

log()  { echo "▶ $*"; }
ok()   { echo "✓ $*"; }

log "Bundling binaries for $PLATFORM → $OUT"

case "$PLATFORM" in
  linux)
    log "Downloading Qdrant $QDRANT_VERSION (linux x86_64)..."
    curl -fsSL \
      "https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/qdrant-x86_64-unknown-linux-musl.tar.gz" \
      | tar xz -C "$OUT"
    ok "Qdrant extracted"

    log "Downloading Ollama $OLLAMA_VERSION (linux amd64)..."
    curl -fsSL \
      "https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-linux-amd64" \
      -o "$OUT/ollama"
    chmod +x "$OUT/qdrant" "$OUT/ollama"
    ok "Ollama downloaded"
    ;;

  windows)
    log "Downloading Qdrant $QDRANT_VERSION (windows x86_64)..."
    curl -fsSL \
      "https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/qdrant-x86_64-pc-windows-msvc.zip" \
      -o /tmp/qdrant-win.zip
    unzip -o /tmp/qdrant-win.zip -d "$OUT"
    rm /tmp/qdrant-win.zip
    ok "Qdrant extracted"

    log "Downloading Ollama $OLLAMA_VERSION (windows amd64)..."
    curl -fsSL \
      "https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-windows-amd64.zip" \
      -o /tmp/ollama-win.zip
    unzip -o /tmp/ollama-win.zip -d "$OUT"
    rm /tmp/ollama-win.zip
    ok "Ollama extracted"
    ;;

  macos)
    # Build universal binary covering both x64 and arm64 via separate downloads
    log "Downloading Qdrant $QDRANT_VERSION (macOS arm64)..."
    curl -fsSL \
      "https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/qdrant-aarch64-apple-darwin.tar.gz" \
      | tar xz -C "$OUT"
    ok "Qdrant (arm64) extracted"

    log "Downloading Ollama $OLLAMA_VERSION (macOS)..."
    curl -fsSL \
      "https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-darwin" \
      -o "$OUT/ollama"
    chmod +x "$OUT/qdrant" "$OUT/ollama"
    ok "Ollama downloaded"
    ;;

  *)
    echo "✗ Unknown platform: $PLATFORM (expected linux|windows|macos)" >&2
    exit 1
    ;;
esac

ok "Binaries bundled for $PLATFORM in $OUT"
echo ""
echo "  qdrant  $(ls -sh "$OUT/qdrant"* | awk '{print $1, $2}')"
echo "  ollama  $(ls -sh "$OUT/ollama"* | awk '{print $1, $2}')"
