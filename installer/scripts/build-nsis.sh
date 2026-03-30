#!/usr/bin/env bash
set -euo pipefail

VERSION="${VERSION:-0.1.0}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/installer/dist"
BINARIES="$ROOT/installer/binaries/windows"
RELEASE="$ROOT/release"
STAGING="$OUT/nsis-staging"

log() { echo -e "\033[0;34m▶\033[0m $*"; }
ok()  { echo -e "\033[0;32m✓\033[0m $*"; }
die() { echo -e "\033[0;31m✗\033[0m $*" >&2; exit 1; }

[ -f "$RELEASE/hippocampus-server-win.exe" ] || die "pkg binary not found. Run: npm run pkg:win"
[ -f "$BINARIES/qdrant.exe" ]                || die "qdrant.exe not found. Run: bash installer/scripts/bundle-binaries.sh windows"
[ -f "$BINARIES/ollama.exe" ]                || die "ollama.exe not found. Run: bash installer/scripts/bundle-binaries.sh windows"

mkdir -p "$STAGING"

# ── Stage files ───────────────────────────────────────────────────────────────
log "Staging files..."
cp "$RELEASE/hippocampus-server-win.exe" "$STAGING/"
cp "$BINARIES/qdrant.exe"                "$STAGING/"
cp "$BINARIES/ollama.exe"                "$STAGING/"

# Native modules
for item in better-sqlite3 onnxruntime-node node_modules; do
  if [ -e "$RELEASE/$item" ]; then
    cp -r "$RELEASE/$item" "$STAGING/"
  fi
done

if [ -f "$ROOT/installer/assets/icon.ico" ]; then
  cp "$ROOT/installer/assets/icon.ico" "$STAGING/"
fi

# ── CLI batch wrapper ─────────────────────────────────────────────────────────
cat > "$STAGING/hippocampus.bat" << 'BAT'
@echo off
setlocal
set DATA_DIR=%LOCALAPPDATA%\Hippocampus
set DB_PATH=%DATA_DIR%\data\hippocampus.db
set TRANSFORMERS_CACHE=%DATA_DIR%\models
set QDRANT_URL=http://localhost:6333
set OLLAMA_URL=http://localhost:11434
"%~dp0hippocampus-server.exe" %*
endlocal
BAT

# ── Launch script ─────────────────────────────────────────────────────────────
cat > "$STAGING/launch.bat" << 'LAUNCH'
@echo off
setlocal
set DATA_DIR=%LOCALAPPDATA%\Hippocampus

if not exist "%DATA_DIR%\data\qdrant"  mkdir "%DATA_DIR%\data\qdrant"
if not exist "%DATA_DIR%\data\ollama"  mkdir "%DATA_DIR%\data\ollama"
if not exist "%DATA_DIR%\data"         mkdir "%DATA_DIR%\data"
if not exist "%DATA_DIR%\models"       mkdir "%DATA_DIR%\models"
if not exist "%DATA_DIR%\uploads"      mkdir "%DATA_DIR%\uploads"
if not exist "%DATA_DIR%\overviews"    mkdir "%DATA_DIR%\overviews"

echo Starting Qdrant...
start "" /B "%~dp0qdrant.exe"

echo Starting Ollama...
start "" /B "%~dp0ollama.exe" serve

timeout /t 3 /nobreak > nul

if not exist "%DATA_DIR%\.models-pulled" (
  echo Pulling AI models - first run, this may take several minutes...
  "%~dp0ollama.exe" pull phi3:mini
  "%~dp0ollama.exe" pull moondream
  echo. > "%DATA_DIR%\.models-pulled"
)

echo Starting Hippocampus server...
set DB_PATH=%DATA_DIR%\data\hippocampus.db
set OVERVIEWS_DIR=%DATA_DIR%\overviews
set TRANSFORMERS_CACHE=%DATA_DIR%\models
set QDRANT_URL=http://localhost:6333
set OLLAMA_URL=http://localhost:11434
set HTTP_PORT=3001
set GRPC_PORT=50051
start "" /B "%~dp0hippocampus-server.exe"

timeout /t 3 /nobreak > nul
echo.
echo Hippocampus is running.
echo   HTTP API: http://localhost:3001
echo   CLI:      hippocampus ingest C:\path\to\file.pdf
echo.
endlocal
LAUNCH

# ── NSIS script ───────────────────────────────────────────────────────────────
mkdir -p "$OUT"

ICON_LINE=""
if [ -f "$STAGING/icon.ico" ]; then
  ICON_LINE="!define MUI_ICON \"${STAGING}/icon.ico\""
fi

NATIVE_LINE=""
if [ -d "$STAGING/native" ]; then
  NATIVE_LINE="File /r \"${STAGING}\\\\native\""
fi

cat > "$OUT/hippocampus.nsi" << NSIS
Unicode True

!define APP_NAME    "Hippocampus"
!define APP_VERSION "${VERSION}"
!define INSTALL_DIR "\$LOCALAPPDATA\\Hippocampus"

Name "\${APP_NAME} \${APP_VERSION}"
OutFile "${OUT}/Hippocampus-Setup-${VERSION}.exe"
InstallDir "\${INSTALL_DIR}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show

!include "MUI2.nsh"
!include "EnvVarUpdate.nsh"

!define MUI_ABORTWARNING
${ICON_LINE}

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "\$INSTDIR\\launch.bat"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Hippocampus"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Hippocampus" SecMain
  SetOutPath "\$INSTDIR"

  File "${STAGING}\\hippocampus-server.exe"
  File "${STAGING}\\qdrant.exe"
  File "${STAGING}\\ollama.exe"
  File "${STAGING}\\hippocampus.bat"
  File "${STAGING}\\launch.bat"
  ${NATIVE_LINE}

  ; Add to PATH so CLI works from any terminal
  \${EnvVarUpdate} \$0 "PATH" "A" "HKCU" "\$INSTDIR"

  ; Start menu + desktop shortcut
  CreateDirectory "\$SMPROGRAMS\\Hippocampus"
  CreateShortcut  "\$SMPROGRAMS\\Hippocampus\\Hippocampus.lnk" "\$INSTDIR\\launch.bat" "" "\$INSTDIR\\hippocampus-server.exe"
  CreateShortcut  "\$DESKTOP\\Hippocampus.lnk"                 "\$INSTDIR\\launch.bat" "" "\$INSTDIR\\hippocampus-server.exe"

  ; Register uninstaller
  WriteUninstaller "\$INSTDIR\\uninstall.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Hippocampus" "DisplayName"     "Hippocampus"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Hippocampus" "UninstallString" '"\$INSTDIR\\uninstall.exe"'
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Hippocampus" "DisplayVersion"  "\${APP_VERSION}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Hippocampus" "Publisher"       "Hippocampus"
SectionEnd

Section "Uninstall"
  \${un.EnvVarUpdate} \$0 "PATH" "R" "HKCU" "\$INSTDIR"
  RMDir /r "\$INSTDIR"
  Delete "\$SMPROGRAMS\\Hippocampus\\*.*"
  RMDir  "\$SMPROGRAMS\\Hippocampus"
  Delete "\$DESKTOP\\Hippocampus.lnk"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Hippocampus"
SectionEnd
NSIS

# ── Compile ───────────────────────────────────────────────────────────────────
if command -v makensis >/dev/null 2>&1; then
  log "Compiling NSIS installer..."
  # Download EnvVarUpdate.nsh if not present (needed for PATH manipulation)
  NSIS_INCLUDE="$(makensis /hdrinfo 2>/dev/null | grep 'Header files:' | cut -d' ' -f3-)"
  if [ -n "$NSIS_INCLUDE" ] && [ ! -f "${NSIS_INCLUDE}/EnvVarUpdate.nsh" ]; then
    curl -fsSL \
      "https://raw.githubusercontent.com/GsNSIS/EnvVarUpdate/master/EnvVarUpdate.nsh" \
      -o "${NSIS_INCLUDE}/EnvVarUpdate.nsh"
  fi
  makensis "$OUT/hippocampus.nsi"
  ok "Windows installer: $OUT/Hippocampus-Setup-$VERSION.exe"
else
  ok "NSIS script written to $OUT/hippocampus.nsi"
  echo "Install NSIS to compile: sudo apt install nsis  (or choco install nsis on Windows)"
fi
