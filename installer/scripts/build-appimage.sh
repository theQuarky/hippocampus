#!/usr/bin/env bash
set -euo pipefail

VERSION="${VERSION:-0.1.0}"
OUT="installer/dist"
APPDIR="$OUT/AppDir"
BINARIES="installer/binaries/linux"

log() { echo -e "\033[0;34m▶\033[0m $*"; }
ok()  { echo -e "\033[0;32m✓\033[0m $*"; }

rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/icons"

# ── Copy server binary + native modules ───────────────────────────────────────
log "Copying server binary..."
cp release/hippocampus-server-linux "$APPDIR/usr/bin/hippocampus-server"
chmod +x "$APPDIR/usr/bin/hippocampus-server"

# Proto definition (must be next to the binary — server reads it at runtime)
[ -f "release/hippocampus.proto" ] && cp release/hippocampus.proto "$APPDIR/usr/bin/"

# Native .node files and ESM packages sit in release/ alongside the binary
for d in better-sqlite3 onnxruntime-node "@tensorflow" libtensorflow*.so*; do
  [ -e "release/$d" ] && cp -r "release/$d" "$APPDIR/usr/bin/"
done
# @xenova/transformers ESM layout (must be resolvable from the binary's directory)
if [ -d "release/node_modules" ]; then
  cp -r release/node_modules "$APPDIR/usr/bin/"
fi
# TensorFlow shared libraries (.so files in release/ root)
find release -maxdepth 1 -name "*.so*" -exec cp {} "$APPDIR/usr/bin/" \;

# ── Copy bundled binaries ─────────────────────────────────────────────────────
log "Copying qdrant..."
cp "$BINARIES/qdrant" "$APPDIR/usr/bin/qdrant"
chmod +x "$APPDIR/usr/bin/qdrant"

log "Copying ollama..."
cp "$BINARIES/ollama" "$APPDIR/usr/bin/ollama"
chmod +x "$APPDIR/usr/bin/ollama"

# ── Icon ──────────────────────────────────────────────────────────────────────
cp installer/assets/icon.png "$APPDIR/hippocampus.png"
cp installer/assets/icon.png "$APPDIR/usr/share/icons/hippocampus.png"
cp installer/assets/icon.png "$APPDIR/.DirIcon"

# ── Desktop file ─────────────────────────────────────────────────────────────
cat > "$APPDIR/hippocampus.desktop" << 'DESKTOP'
[Desktop Entry]
Name=Hippocampus
Comment=Local AI Memory System
Exec=hippocampus
Icon=hippocampus
Type=Application
Categories=Utility;
DESKTOP

# ── AppRun entry script ───────────────────────────────────────────────────────
cat > "$APPDIR/AppRun" << 'APPRUN'
#!/bin/sh
set -e

SELF="$(readlink -f "$0")"
HERE="$(dirname "$SELF")"
BIN="$HERE/usr/bin"
DATA_DIR="${HIPPOCAMPUS_DATA:-$HOME/.hippocampus}"

mkdir -p "$DATA_DIR/data/qdrant" \
         "$DATA_DIR/data/ollama" \
         "$DATA_DIR/data" \
         "$DATA_DIR/models" \
         "$DATA_DIR/uploads" \
         "$DATA_DIR/overviews"

# ── Start Qdrant ──────────────────────────────────────────────────────────────
if ! pgrep -x qdrant > /dev/null 2>&1; then
  QDRANT__STORAGE__STORAGE_PATH="$DATA_DIR/data/qdrant" \
  "$BIN/qdrant" &
  sleep 1
fi

# ── Start Ollama ──────────────────────────────────────────────────────────────
if ! pgrep -x ollama > /dev/null 2>&1; then
  OLLAMA_MODELS="$DATA_DIR/data/ollama" \
  "$BIN/ollama" serve &
  sleep 2

  if [ ! -f "$DATA_DIR/.models-pulled" ]; then
    echo "Pulling AI models on first run (this may take several minutes)..."
    "$BIN/ollama" pull phi3:mini
    "$BIN/ollama" pull moondream
    touch "$DATA_DIR/.models-pulled"
  fi
fi

# ── Start Hippocampus server ──────────────────────────────────────────────────
DB_PATH="$DATA_DIR/data/hippocampus.db" \
OVERVIEWS_DIR="$DATA_DIR/overviews" \
TRANSFORMERS_CACHE="$DATA_DIR/models" \
QDRANT_URL="http://localhost:6333" \
OLLAMA_URL="http://localhost:11434" \
HTTP_PORT=3001 \
GRPC_PORT=50051 \
LD_LIBRARY_PATH="$BIN:${LD_LIBRARY_PATH:-}" \
"$BIN/hippocampus-server" &

# ── Wait then open browser ────────────────────────────────────────────────────
sleep 3
if command -v xdg-open > /dev/null 2>&1; then
  xdg-open "http://localhost:3001"
elif command -v open > /dev/null 2>&1; then
  open "http://localhost:3001"
fi

echo ""
echo "Hippocampus is running"
echo "  Dashboard: http://localhost:3001"
echo "  Data dir:  $DATA_DIR"
echo ""
echo "Press Ctrl+C to stop"

wait
APPRUN

chmod +x "$APPDIR/AppRun"

# ── CLI wrapper ───────────────────────────────────────────────────────────────
cat > "$APPDIR/usr/bin/hippocampus" << 'CLI'
#!/bin/sh
SELF="$(readlink -f "$0")"
HERE="$(dirname "$SELF")"
DATA_DIR="${HIPPOCAMPUS_DATA:-$HOME/.hippocampus}"

DB_PATH="$DATA_DIR/data/hippocampus.db" \
TRANSFORMERS_CACHE="$DATA_DIR/models" \
QDRANT_URL="http://localhost:6333" \
OLLAMA_URL="http://localhost:11434" \
LD_LIBRARY_PATH="$HERE:${LD_LIBRARY_PATH:-}" \
"$HERE/hippocampus-server" "$@"
CLI
chmod +x "$APPDIR/usr/bin/hippocampus"

# ── Download appimagetool and build AppImage ──────────────────────────────────
APPIMAGETOOL="$OUT/appimagetool"
if [ ! -f "$APPIMAGETOOL" ]; then
  log "Downloading appimagetool..."
  curl -fsSL \
    "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage" \
    -o "$APPIMAGETOOL"
  chmod +x "$APPIMAGETOOL"
fi

log "Building AppImage..."
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGETOOL" "$APPDIR" "$OUT/Hippocampus-$VERSION.AppImage"
chmod +x "$OUT/Hippocampus-$VERSION.AppImage"

ok "AppImage built: $OUT/Hippocampus-$VERSION.AppImage"
ls -lh "$OUT/Hippocampus-$VERSION.AppImage"
