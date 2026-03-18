/**
 * Thin wrappers around the IPC bridge for use in wizard steps.
 * All actual work runs in the main process via Electron IPC.
 */

export async function createDataDirs(dataDir: string): Promise<void> {
  await window.hippocampus.createDataDirs(dataDir);
}

export async function downloadModels(models: string[]): Promise<void> {
  await window.hippocampus.downloadModels(models);
}
