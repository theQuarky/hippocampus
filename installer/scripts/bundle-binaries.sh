#!/usr/bin/env bash
# Downloads qdrant and ollama binaries for the target platform.
# Usage: bash installer/scripts/bundle-binaries.sh <linux|windows>
#
# Override versions via env vars:
#   QDRANT_VERSION=v1.13.4 OLLAMA_VERSION=v0.6.5 bash bundle-binaries.sh linux
set -euo pipefail

PLATFORM="${1:?Usage: bundle-binaries.sh <linux|windows>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/installer/binaries/$PLATFORM"

log() { echo -e "\033[0;34m▶\033[0m $*"; }
ok()  { echo -e "\033[0;32m✓\033[0m $*"; }
die() { echo -e "\033[0;31m✗\033[0m $*" >&2; exit 1; }

mkdir -p "$OUT"

# ── Resolve latest versions via GitHub API ────────────────────────────────────
gh_latest() {
  curl -sfL \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$1/releases/latest" \
    | grep '"tag_name"' | head -1 | cut -d'"' -f4
}

QDRANT_VERSION="${QDRANT_VERSION:-}"
OLLAMA_VERSION="${OLLAMA_VERSION:-}"

if [ -z "$QDRANT_VERSION" ]; then
  log "Resolving latest Qdrant version..."
  QDRANT_VERSION=$(gh_latest "qdrant/qdrant")
  [ -n "$QDRANT_VERSION" ] || die "Failed to resolve Qdrant version. Set QDRANT_VERSION env var."
  log "Qdrant: $QDRANT_VERSION"
fi

if [ -z "$OLLAMA_VERSION" ]; then
  log "Resolving latest Ollama version..."
  OLLAMA_VERSION=$(gh_latest "ollama/ollama")
  [ -n "$OLLAMA_VERSION" ] || die "Failed to resolve Ollama version. Set OLLAMA_VERSION env var."
  log "Ollama: $OLLAMA_VERSION"
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ── Helper: extract a single file from a zip ──────────────────────────────────
extract_from_zip() {
  local zip="$1" member="$2" dest="$3"
  if command -v unzip >/dev/null 2>&1; then
    unzip -p "$zip" "$member" > "$dest"
  else
    # tar understands zip on most platforms (Windows Git Bash, macOS, modern Linux)
    tar -xf "$zip" -C "$(dirname "$dest")" "$member"
    [ -f "$(dirname "$dest")/$member" ] && mv "$(dirname "$dest")/$member" "$dest"
  fi
}

if [ "$PLATFORM" = "linux" ]; then

  # ── Qdrant ──────────────────────────────────────────────────────────────────
  if [ ! -f "$OUT/qdrant" ]; then
    log "Downloading qdrant $QDRANT_VERSION (linux x86_64)..."
    curl -fSL \
      "https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/qdrant-x86_64-unknown-linux-musl.tar.gz" \
      -o "$TMP/qdrant.tar.gz"
    tar -xzf "$TMP/qdrant.tar.gz" -C "$TMP"
    # Binary may be at root or in a subdirectory
    find "$TMP" -maxdepth 2 -name "qdrant" -not -name "*.tar.gz" | head -1 \
      | xargs -I{} mv {} "$OUT/qdrant"
    chmod +x "$OUT/qdrant"
    ok "qdrant ready: $OUT/qdrant"
  else
    ok "qdrant already present (skipping)"
  fi

  # ── Ollama ───────────────────────────────────────────────────────────────────
  if [ ! -f "$OUT/ollama" ]; then
    log "Downloading ollama $OLLAMA_VERSION (linux amd64)..."
    # Ollama provides a tgz with bin/ollama inside
    OLLAMA_URL="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-linux-amd64.tgz"
    curl -fSL "$OLLAMA_URL" -o "$TMP/ollama.tgz"
    tar -xzf "$TMP/ollama.tgz" -C "$TMP"
    # Find the ollama binary (may be at bin/ollama or ./ollama)
    OLLAMA_BIN=$(find "$TMP" -maxdepth 3 -name "ollama" -type f | head -1)
    [ -n "$OLLAMA_BIN" ] || die "Could not find ollama binary inside tgz"
    mv "$OLLAMA_BIN" "$OUT/ollama"
    chmod +x "$OUT/ollama"
    ok "ollama ready: $OUT/ollama"
  else
    ok "ollama already present (skipping)"
  fi

elif [ "$PLATFORM" = "windows" ]; then

  # ── Qdrant ──────────────────────────────────────────────────────────────────
  if [ ! -f "$OUT/qdrant.exe" ]; then
    log "Downloading qdrant $QDRANT_VERSION (windows x86_64)..."
    curl -fSL \
      "https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/qdrant-x86_64-pc-windows-msvc.zip" \
      -o "$TMP/qdrant.zip"
    extract_from_zip "$TMP/qdrant.zip" "qdrant.exe" "$OUT/qdrant.exe"
    ok "qdrant.exe ready: $OUT/qdrant.exe"
  else
    ok "qdrant.exe already present (skipping)"
  fi

  # ── Ollama ───────────────────────────────────────────────────────────────────
  if [ ! -f "$OUT/ollama.exe" ]; then
    log "Downloading ollama $OLLAMA_VERSION (windows amd64)..."
    OLLAMA_URL="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-windows-amd64.zip"
    curl -fSL "$OLLAMA_URL" -o "$TMP/ollama.zip"
    # Extract ollama.exe from the zip
    extract_from_zip "$TMP/ollama.zip" "ollama.exe" "$OUT/ollama.exe"
    ok "ollama.exe ready: $OUT/ollama.exe"
  else
    ok "ollama.exe already present (skipping)"
  fi

else
  die "Unknown platform: '$PLATFORM'  (expected: linux | windows)"
fi

ok "Done. Binaries in $OUT/"
ls -lh "$OUT/"
