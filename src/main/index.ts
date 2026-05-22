// 主进程入口
import { app, BrowserWindow, Menu, Tray, ipcMain, screen, nativeImage } from 'electron';
import { join } from 'path';

let petWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createPetWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;

  petWindow = new BrowserWindow({
    width: 220,
    height: 280,
    x: screenWidth - 260,
    y: screenHeight - 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setVisibleOnAllWorkspaces(true);

  if (process.env['ELECTRON_RENDERER_URL']) {
    petWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    petWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  petWindow.on('closed', () => {
    petWindow = null;
  });
}

function createTray() {
  // 占位托盘图标 — 后续替换为正式 ico
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('九十九夜梦');

  const menu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏',
      click: () => {
        if (!petWindow) return;
        if (petWindow.isVisible()) petWindow.hide();
        else petWindow.show();
      }
    },
    {
      label: '设置',
      click: () => {
        petWindow?.webContents.send('open-settings');
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);

  tray.on('double-click', () => {
    petWindow?.show();
  });
}

// IPC: 拖拽位置同步(渲染端通过 -webkit-app-region: drag 即可, 这里留作扩展)
ipcMain.handle('pet:hide', () => petWindow?.hide());
ipcMain.handle('pet:quit', () => app.quit());

app.whenReady().then(() => {
  createPetWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });
});

// 桌宠应常驻, 不因关窗退出: 不监听 window-all-closed 即可
// (除 macOS 外, 默认行为是关窗后退出 — 但 tray 持有应用所以不会真退出)

