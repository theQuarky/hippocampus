// Type declarations for the IPC bridge exposed by electron/preload.ts
interface HippocampusElectronAPI {
  pickDirectory():    Promise<string | null>;
  getDefaultDir():    Promise<string>;
  createDataDirs(dataDir: string): Promise<void>;
  downloadModels(models: string[]): Promise<void>;
  installComplete(dataDir: string): Promise<void>;
  openDashboard():    Promise<void>;
  getInstallStatus(): Promise<{ installed: boolean; dataDir: string }>;
}

declare global {
  interface Window {
    hippocampus: HippocampusElectronAPI;
  }
}

export {};
