import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import log from 'electron-log';
import Store from 'electron-store';
import { setupTray } from './tray';

const store = new Store();
const serverProcesses: ChildProcess[] = [];
let wizardWindow: BrowserWindow | null = null;

const isInstalled = () => store.get('installed', false) as boolean;
const getDataDir  = () =>
  store.get('dataDir', path.join(app.getPath('userData'), 'hippocampus')) as string;
const SERVER_PORT = 3001;

// ── Server management ─────────────────────────────────────────────────────────
function startServer(): void {
  // Use Electron's own Node binary to run the compiled server
  const serverScript = path.join(
    process.resourcesPath, 'app', 'dist', 'server', 'index.js'
  );

  if (!fs.existsSync(serverScript)) {
    log.error('Server script not found:', serverScript);
    return;
  }

  log.info('Starting server:', serverScript);

  const child = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HTTP_PORT: String(SERVER_PORT),
      GRPC_PORT: '50051',
      DB_PATH: path.join(getDataDir(), 'hippocampus.db'),
      OVERVIEWS_DIR: path.join(getDataDir(), 'overviews'),
      TRANSFORMERS_CACHE: path.join(getDataDir(), 'models'),
      PIPER_VOICES_DIR: path.join(getDataDir(), 'piper-voices'),
      QDRANT_URL: 'http://localhost:6333',
      OLLAMA_URL: 'http://localhost:11434',
      CUDA_VISIBLE_DEVICES: '-1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', d => log.info('[server]', d.toString().trim()));
  child.stderr?.on('data', d => log.warn('[server]', d.toString().trim()));
  child.on('exit', code => {
    log.warn('Server exited with code', code);
    const idx = serverProcesses.indexOf(child);
    if (idx !== -1) serverProcesses.splice(idx, 1);
  });

  serverProcesses.push(child);
}

function stopAllServers(): void {
  for (const child of serverProcesses) {
    child.kill();
  }
  serverProcesses.length = 0;
}

// ── Bundled binaries ──────────────────────────────────────────────────────────
// Qdrant and Ollama are bundled via electron-builder extraResources into
// <resourcesPath>/binaries/. We always use absolute paths — never PATH.
function startBundledServices(): void {
  const binDir = path.join(process.resourcesPath, 'binaries');
  const dataDir = getDataDir();

  const ext = process.platform === 'win32' ? '.exe' : '';

  // ── Qdrant ──
  const qdrantBin = path.join(binDir, `qdrant${ext}`);
  if (fs.existsSync(qdrantBin)) {
    const qdrantStorage = path.join(dataDir, 'qdrant');
    fs.mkdirSync(qdrantStorage, { recursive: true });

    const qdrant = spawn(qdrantBin, [], {
      env: {
        ...process.env,
        QDRANT__STORAGE__STORAGE_PATH: qdrantStorage,
      },
      stdio: 'ignore',
      detached: false,
    });
    qdrant.on('error', e => log.error('Qdrant failed to start:', e));
    log.info('Qdrant started, pid:', qdrant.pid);
    serverProcesses.push(qdrant);
  } else {
    log.warn('Qdrant binary not found at', qdrantBin, '— skipping');
  }

  // ── Ollama ──
  const ollamaBin = path.join(binDir, `ollama${ext}`);
  if (fs.existsSync(ollamaBin)) {
    const ollamaModels = path.join(dataDir, 'ollama');
    fs.mkdirSync(ollamaModels, { recursive: true });

    const ollama = spawn(ollamaBin, ['serve'], {
      env: {
        ...process.env,
        OLLAMA_MODELS: ollamaModels,
      },
      stdio: 'ignore',
      detached: false,
    });
    ollama.on('error', e => log.error('Ollama failed to start:', e));
    log.info('Ollama started, pid:', ollama.pid);
    serverProcesses.push(ollama);
  } else {
    log.warn('Ollama binary not found at', ollamaBin, '— skipping');
  }
}

// ── Wizard window ─────────────────────────────────────────────────────────────
function createWizardWindow(): void {
  wizardWindow = new BrowserWindow({
    width: 560,
    height: 680,
    resizable: false,
    center: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    wizardWindow.loadURL('http://localhost:5173');
    wizardWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    wizardWindow.loadFile(path.join(__dirname, '..', 'wizard', 'index.html'));
  }

  wizardWindow.on('closed', () => { wizardWindow = null; });
}

// ── IPC — directory / status ──────────────────────────────────────────────────
ipcMain.handle('pick-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose Hippocampus data directory',
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-default-dir', () =>
  path.join(app.getPath('home'), 'hippocampus')
);

ipcMain.handle('get-install-status', () => ({
  installed: isInstalled(),
  dataDir: getDataDir(),
}));

// ── IPC — installation steps ──────────────────────────────────────────────────
ipcMain.handle('create-data-dirs', (_event, dataDir: string) => {
  const subdirs = [
    'qdrant', 'ollama', 'hippocampus', 'models',
    'piper-voices', 'overviews',
  ];
  for (const sub of subdirs) {
    fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
  }
});

ipcMain.handle('download-models', async (_event, models: string[]) => {
  // Ollama must already be running (started by startBundledServices).
  // We spawn `ollama pull` for each requested model.
  const binDir = path.join(process.resourcesPath, 'binaries');
  const ext = process.platform === 'win32' ? '.exe' : '';
  const ollamaBin = path.join(binDir, `ollama${ext}`);

  if (!fs.existsSync(ollamaBin)) {
    throw new Error(`Ollama binary not found at ${ollamaBin}`);
  }

  for (const model of models) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ollamaBin, ['pull', model], {
        env: { ...process.env },
        stdio: 'inherit',
      });
      child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`ollama pull ${model} exited with ${code}`))));
      child.on('error', reject);
    });
  }
});

ipcMain.handle('install-complete', (_event, dataDir: string) => {
  store.set('installed', true);
  store.set('dataDir', dataDir);
  wizardWindow?.close();
  startBundledServices();
  startServer();
  setupTray(app, SERVER_PORT);
  shell.openExternal(`http://localhost:${SERVER_PORT}`);
});

ipcMain.handle('open-dashboard', () => {
  shell.openExternal(`http://localhost:${SERVER_PORT}`);
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (!isInstalled()) {
    createWizardWindow();
  } else {
    startBundledServices();
    startServer();
    setupTray(app, SERVER_PORT);
  }
});

// Keep running in system tray — don't quit when all windows close
app.on('window-all-closed', () => {
  // Intentionally empty: stay alive in tray
});

app.on('before-quit', () => {
  stopAllServers();
});

app.on('activate', () => {
  // macOS dock click: re-open wizard if not installed, else open dashboard
  if (!isInstalled() && wizardWindow === null) {
    createWizardWindow();
  } else if (isInstalled()) {
    shell.openExternal(`http://localhost:${SERVER_PORT}`);
  }
});
