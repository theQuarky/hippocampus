#!/usr/bin/env bash
set -euo pipefail

VERSION="${VERSION:-0.1.0}"
OUT="installer/dist"
BINARIES="installer/binaries/windows"
NSIS_DIR="$OUT/nsis-staging"

log() { echo -e "\033[0;34m▶\033[0m $*"; }
ok()  { echo -e "\033[0;32m✓\033[0m $*"; }

mkdir -p "$NSIS_DIR"

# ── Stage files ───────────────────────────────────────────────────────────────
log "Staging files..."
cp release/hippocampus-server-win.exe "$NSIS_DIR/"
cp "$BINARIES/qdrant.exe"             "$NSIS_DIR/"
cp "$BINARIES/ollama.exe"             "$NSIS_DIR/"
cp installer/assets/icon.ico          "$NSIS_DIR/" 2>/dev/null || true

# Copy native .node files that sit alongside the pkg binary
for dir in better-sqlite3 onnxruntime-node @tensorflow; do
  if [ -d "release/$dir" ]; then
    cp -r "release/$dir" "$NSIS_DIR/"
  fi
done

# ── CLI batch wrapper ─────────────────────────────────────────────────────────
cat > "$NSIS_DIR/hippocampus.bat" << 'BAT'
@echo off
set DATA_DIR=%LOCALAPPDATA%\Hippocampus
set DB_PATH=%DATA_DIR%\data\hippocampus.db
set TRANSFORMERS_CACHE=%DATA_DIR%\models
set QDRANT_URL=http://localhost:6333
set OLLAMA_URL=http://localhost:11434
"%~dp0hippocampus-server.exe" %*
BAT

# ── Launch script ─────────────────────────────────────────────────────────────
cat > "$NSIS_DIR/launch.bat" << 'LAUNCH'
@echo off
set DATA_DIR=%LOCALAPPDATA%\Hippocampus

if not exist "%DATA_DIR%\data\qdrant" mkdir "%DATA_DIR%\data\qdrant"
if not exist "%DATA_DIR%\data\ollama" mkdir "%DATA_DIR%\data\ollama"
if not exist "%DATA_DIR%\models"      mkdir "%DATA_DIR%\models"
if not exist "%DATA_DIR%\uploads"     mkdir "%DATA_DIR%\uploads"
if not exist "%DATA_DIR%\overviews"   mkdir "%DATA_DIR%\overviews"

echo Starting Qdrant...
start /B "" "%~dp0qdrant.exe" --storage-path "%DATA_DIR%\data\qdrant"

echo Starting Ollama...
start /B "" "%~dp0ollama.exe" serve

timeout /t 2 /nobreak >nul

if not exist "%DATA_DIR%\.models-pulled" (
  echo Pulling AI models on first run ^(this may take several minutes^)...
  "%~dp0ollama.exe" pull phi3:mini
  "%~dp0ollama.exe" pull moondream
  echo. > "%DATA_DIR%\.models-pulled"
)

echo Starting Hippocampus...
set DB_PATH=%DATA_DIR%\data\hippocampus.db
set OVERVIEWS_DIR=%DATA_DIR%\overviews
set TRANSFORMERS_CACHE=%DATA_DIR%\models
set QDRANT_URL=http://localhost:6333
set OLLAMA_URL=http://localhost:11434
set HTTP_PORT=3001
set GRPC_PORT=50051
start /B "" "%~dp0hippocampus-server.exe"

timeout /t 3 /nobreak >nul
start http://localhost:3001
LAUNCH

# ── NSIS script ───────────────────────────────────────────────────────────────
cat > "$OUT/hippocampus.nsi" << NSIS
Unicode True
!define APP_NAME    "Hippocampus"
!define APP_VERSION "${VERSION}"
!define INSTALL_DIR "\$LOCALAPPDATA\Hippocampus"

Name "\${APP_NAME} \${APP_VERSION}"
OutFile "$OUT/Hippocampus-Setup-${VERSION}.exe"
InstallDir "\${INSTALL_DIR}"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "EnVar.nsh"

!define MUI_ABORTWARNING
!define MUI_ICON "$NSIS_DIR/icon.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "\$INSTDIR"

  File "$NSIS_DIR\hippocampus-server.exe"
  File "$NSIS_DIR\qdrant.exe"
  File "$NSIS_DIR\ollama.exe"
  File "$NSIS_DIR\hippocampus.bat"
  File "$NSIS_DIR\launch.bat"

  ; Native modules
  File /r /x "*.nsi" "$NSIS_DIR\better-sqlite3" 2>nul || true
  File /r /x "*.nsi" "$NSIS_DIR\onnxruntime-node" 2>nul || true

  ; Start Menu shortcut
  CreateDirectory "\$SMPROGRAMS\Hippocampus"
  CreateShortcut  "\$SMPROGRAMS\Hippocampus\Hippocampus.lnk" "\$INSTDIR\launch.bat" "" "\$INSTDIR\icon.ico"
  CreateShortcut  "\$DESKTOP\Hippocampus.lnk" "\$INSTDIR\launch.bat" "" "\$INSTDIR\icon.ico"

  ; Add install dir to user PATH
  EnVar::SetHKCU
  EnVar::AddValue "PATH" "\$INSTDIR"

  ; Write uninstaller
  WriteUninstaller "\$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hippocampus" \
    "DisplayName" "Hippocampus"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hippocampus" \
    "UninstallString" "\$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hippocampus" \
    "DisplayVersion" "\${APP_VERSION}"
SectionEnd

Section "Uninstall"
  EnVar::SetHKCU
  EnVar::DeleteValue "PATH" "\$INSTDIR"

  Delete "\$INSTDIR\*.*"
  RMDir  "\$INSTDIR"
  Delete "\$SMPROGRAMS\Hippocampus\*.*"
  RMDir  "\$SMPROGRAMS\Hippocampus"
  Delete "\$DESKTOP\Hippocampus.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hippocampus"
SectionEnd
NSIS

# ── Compile NSIS ──────────────────────────────────────────────────────────────
if command -v makensis > /dev/null 2>&1; then
  log "Compiling NSIS installer..."
  makensis "$OUT/hippocampus.nsi"
  ok "Windows installer built: $OUT/Hippocampus-Setup-${VERSION}.exe"
else
  log "makensis not found — NSIS script written to $OUT/hippocampus.nsi"
  log "On Windows CI: choco install nsis nsis-nlocl -y"
fi
