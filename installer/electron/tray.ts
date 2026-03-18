import { Tray, Menu, shell, app, nativeImage } from 'electron';
import path from 'path';

let tray: Tray | null = null;

export function setupTray(application: typeof app, port: number): void {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => shell.openExternal(`http://localhost:${port}`),
    },
    { type: 'separator' },
    {
      label: `Running on :${port}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit Hippocampus',
      click: () => application.quit(),
    },
  ]);

  tray.setToolTip('Hippocampus — running');
  tray.setContextMenu(menu);
  tray.on('double-click', () => shell.openExternal(`http://localhost:${port}`));
}
