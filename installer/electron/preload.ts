import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('hippocampus', {
  pickDirectory:    ():                         Promise<string | null> => ipcRenderer.invoke('pick-directory'),
  getDefaultDir:    ():                         Promise<string>        => ipcRenderer.invoke('get-default-dir'),
  createDataDirs:   (dataDir: string):          Promise<void>          => ipcRenderer.invoke('create-data-dirs', dataDir),
  downloadModels:   (models: string[]):         Promise<void>          => ipcRenderer.invoke('download-models', models),
  installComplete:  (dataDir: string):          Promise<void>          => ipcRenderer.invoke('install-complete', dataDir),
  openDashboard:    ():                         Promise<void>          => ipcRenderer.invoke('open-dashboard'),
  getInstallStatus: (): Promise<{ installed: boolean; dataDir: string }> => ipcRenderer.invoke('get-install-status'),
});
