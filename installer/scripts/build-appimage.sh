#!/usr/bin/env bash
set -euo pipefail

VERSION="${VERSION:-0.1.0}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/installer/dist"
APPDIR="$OUT/AppDir"
BINARIES="$ROOT/installer/binaries/linux"
RELEASE="$ROOT/release"

log() { echo -e "\033[0;34m▶\033[0m $*"; }
ok()  { echo -e "\033[0;32m✓\033[0m $*"; }
die() { echo -e "\033[0;31m✗\033[0m $*" >&2; exit 1; }

[ -f "$RELEASE/hippocampus-server-linux" ] || die "pkg binary not found. Run: npm run pkg:linux"
[ -f "$BINARIES/qdrant" ]                  || die "qdrant not found. Run: bash installer/scripts/bundle-binaries.sh linux"
[ -f "$BINARIES/ollama" ]                  || die "ollama not found. Run: bash installer/scripts/bundle-binaries.sh linux"

mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/icons/hicolor/256x256/apps"

# ── Binaries ──────────────────────────────────────────────────────────────────
log "Copying binaries..."
# pkg-fix.sh renames the raw binary to hippocampus-server-linux.bin and places
# a bash wrapper at hippocampus-server-linux that sets LD_LIBRARY_PATH. The
# wrapper hardcodes the .bin name, so both files must keep their original names.
cp "$RELEASE/hippocampus-server-linux" "$APPDIR/usr/bin/hippocampus-server-linux"
chmod +x "$APPDIR/usr/bin/hippocampus-server-linux"
if [ -f "$RELEASE/hippocampus-server-linux.bin" ]; then
  cp "$RELEASE/hippocampus-server-linux.bin" "$APPDIR/usr/bin/hippocampus-server-linux.bin"
fi

# Copy native modules and helper libs alongside the binary (same dir is $BIN)
for item in better-sqlite3 onnxruntime-node "@tensorflow" node_modules hippocampus.proto; do
  if [ -e "$RELEASE/$item" ]; then
    cp -r "$RELEASE/$item" "$APPDIR/usr/bin/"
  fi
done
# TensorFlow shared libraries sit directly in release/
find "$RELEASE" -maxdepth 1 -name "*.so*" -exec cp {} "$APPDIR/usr/bin/" \;

cp "$BINARIES/qdrant" "$APPDIR/usr/bin/qdrant"
cp "$BINARIES/ollama" "$APPDIR/usr/bin/ollama"
chmod +x "$APPDIR/usr/bin/qdrant" "$APPDIR/usr/bin/ollama"

# ── Icon ──────────────────────────────────────────────────────────────────────
if [ -f "$ROOT/installer/assets/icon.png" ]; then
  cp "$ROOT/installer/assets/icon.png" \
     "$APPDIR/usr/share/icons/hicolor/256x256/apps/hippocampus.png"
  cp "$ROOT/installer/assets/icon.png" "$APPDIR/.DirIcon"
fi

# ── Desktop entry ─────────────────────────────────────────────────────────────
cat > "$APPDIR/hippocampus.desktop" << 'EOF'
[Desktop Entry]
Name=Hippocampus
Comment=Local AI Memory System
Exec=AppRun
Icon=hippocampus
Type=Application
Categories=Utility;Science;
Terminal=true
EOF

# ── AppRun ────────────────────────────────────────────────────────────────────
cat > "$APPDIR/AppRun" << 'EOF'
#!/bin/sh
# Hippocampus AppRun — starts Qdrant, Ollama, and the server

SELF="$(readlink -f "$0")"
HERE="$(dirname "$SELF")"
BIN="$HERE/usr/bin"
DATA_DIR="${HIPPOCAMPUS_DATA:-$HOME/.hippocampus}"

# Create data directories
mkdir -p \
  "$DATA_DIR/data/qdrant" \
  "$DATA_DIR/data/ollama" \
  "$DATA_DIR/data" \
  "$DATA_DIR/models" \
  "$DATA_DIR/uploads" \
  "$DATA_DIR/overviews"

# ── Start Qdrant ──────────────────────────────────────────────────────────────
if ! pgrep -x qdrant > /dev/null 2>&1; then
  QDRANT__STORAGE__STORAGE_PATH="$DATA_DIR/data/qdrant" \
    "$BIN/qdrant" > "$DATA_DIR/qdrant.log" 2>&1 &
  QDRANT_PID=$!
  echo "▶ Qdrant started (pid $QDRANT_PID)"
  sleep 1
fi

# ── Start Ollama ──────────────────────────────────────────────────────────────
if ! pgrep -x ollama > /dev/null 2>&1; then
  OLLAMA_MODELS="$DATA_DIR/data/ollama" \
    "$BIN/ollama" serve > "$DATA_DIR/ollama.log" 2>&1 &
  OLLAMA_PID=$!
  echo "▶ Ollama started (pid $OLLAMA_PID)"
  sleep 2

  # Pull models on first run
  if [ ! -f "$DATA_DIR/.models-pulled" ]; then
    echo "▶ Pulling AI models on first run (~4GB, this may take several minutes)..."
    OLLAMA_MODELS="$DATA_DIR/data/ollama" "$BIN/ollama" pull phi3:mini
    OLLAMA_MODELS="$DATA_DIR/data/ollama" "$BIN/ollama" pull moondream
    touch "$DATA_DIR/.models-pulled"
    echo "✓ Models ready"
  fi
fi

# ── Handle CLI commands ───────────────────────────────────────────────────────
# If arguments are passed, run as CLI (ingest, query, etc.)
# If no arguments, start the server
if [ $# -gt 0 ]; then
  DB_PATH="$DATA_DIR/data/hippocampus.db" \
  TRANSFORMERS_CACHE="$DATA_DIR/models" \
  QDRANT_URL="http://localhost:6333" \
  OLLAMA_URL="http://localhost:11434" \
    "$BIN/hippocampus-server-linux" "$@"
  exit $?
fi

# ── Start server ──────────────────────────────────────────────────────────────
echo "▶ Starting Hippocampus server..."
DB_PATH="$DATA_DIR/data/hippocampus.db" \
OVERVIEWS_DIR="$DATA_DIR/overviews" \
TRANSFORMERS_CACHE="$DATA_DIR/models" \
QDRANT_URL="http://localhost:6333" \
OLLAMA_URL="http://localhost:11434" \
HTTP_PORT=3001 \
GRPC_PORT=50051 \
  "$BIN/hippocampus-server-linux"
EOF

chmod +x "$APPDIR/AppRun"

# ── Build AppImage ────────────────────────────────────────────────────────────
APPIMAGETOOL="$OUT/appimagetool-x86_64.AppImage"
if [ ! -f "$APPIMAGETOOL" ]; then
  log "Downloading appimagetool..."
  curl -fsSL \
    "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage" \
    -o "$APPIMAGETOOL"
  chmod +x "$APPIMAGETOOL"
fi

log "Building AppImage..."
ARCH=x86_64 "$APPIMAGETOOL" "$APPDIR" "$OUT/Hippocampus-$VERSION.AppImage" 2>&1
chmod +x "$OUT/Hippocampus-$VERSION.AppImage"

ok "AppImage built: $OUT/Hippocampus-$VERSION.AppImage"
echo ""
ls -lh "$OUT/Hippocampus-$VERSION.AppImage"
echo ""
echo "Usage:"
echo "  ./Hippocampus-$VERSION.AppImage              # start server"
echo "  ./Hippocampus-$VERSION.AppImage ingest f.pdf # CLI"
echo "  ./Hippocampus-$VERSION.AppImage query 'text' # CLI"
