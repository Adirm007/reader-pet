// 主进程入口
import { app, BrowserWindow, Menu, Tray, ipcMain, screen, nativeImage } from 'electron';
import { join, extname } from 'path';
import { promises as fs } from 'fs';
import { registerIpc } from './ipc';
import { getConfig } from './config';
import { setPetWindowGetter, startBridge, stopBridge } from './claude-code-bridge';
import { setProactivePetWindowGetter, startProactive, stopProactive } from './proactive';
import { closeMemory } from './memory/store';

let petWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createPetWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;
  const cfg = getConfig();
  const scale = (cfg.window.petSize ?? 100) / 100;
  const w = Math.round(260 * scale);
  const h = Math.round(360 * scale);

  petWindow = new BrowserWindow({
    width: w,
    height: h,
    x: screenWidth - w - 40,
    y: screenHeight - h - 40,
    frame: false,
    transparent: true,
    alwaysOnTop: cfg.window.alwaysOnTop,
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

  if (cfg.window.alwaysOnTop) {
    petWindow.setAlwaysOnTop(true, 'screen-saver');
  }
  petWindow.setVisibleOnAllWorkspaces(true);

  const baseUrl = process.env['ELECTRON_RENDERER_URL'];
  if (baseUrl) {
    petWindow.loadURL(`${baseUrl}/?win=pet`);
  } else {
    petWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { win: 'pet' } });
  }

  petWindow.on('closed', () => {
    petWindow = null;
  });
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 760,
    height: 620,
    title: '九十九夜梦 · 设置',
    frame: true,
    transparent: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  const baseUrl = process.env['ELECTRON_RENDERER_URL'];
  if (baseUrl) {
    settingsWindow.loadURL(`${baseUrl}/?win=settings`);
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { win: 'settings' }
    });
  }
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createTray() {
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
      click: () => openSettingsWindow()
    },
    {
      label: '全屏面板',
      click: () => openPanelWindow()
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => petWindow?.show());
}

function openPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    panelWindow.focus();
    return;
  }
  panelWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    title: '九十九夜梦 · 全屏面板',
    frame: true,
    transparent: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  const baseUrl = process.env['ELECTRON_RENDERER_URL'];
  if (baseUrl) {
    panelWindow.loadURL(`${baseUrl}/?win=panel`);
  } else {
    panelWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { win: 'panel' }
    });
  }
  panelWindow.on('closed', () => {
    panelWindow = null;
  });
}

ipcMain.handle('panel:open', () => openPanelWindow());
ipcMain.handle('panel:close', () => panelWindow?.close());

// 渲染端通过这个 IPC 把磁盘图片转 data: URL — 绕过 file:// 限制
ipcMain.handle('panel:loadLive2dAsset', async (_, p: string) => {
  if (!p || typeof p !== 'string') return { ok: false, reason: '空路径' };
  try {
    const ext = extname(p).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    if (!mimeMap[ext]) {
      return { ok: false, reason: '暂只支持 png/jpg/gif/webp 静态立绘; .model3.json 等待 Live2D Web SDK 接入' };
    }
    const buf = await fs.readFile(p);
    return {
      ok: true,
      dataUrl: `data:${mimeMap[ext]};base64,${buf.toString('base64')}`
    };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
});

ipcMain.handle('pet:hide', () => petWindow?.hide());
ipcMain.handle('pet:quit', () => app.quit());
ipcMain.handle('window:reload-pet', () => {
  if (petWindow) {
    petWindow.close();
    petWindow = null;
  }
  createPetWindow();
});

app.whenReady().then(() => {
  registerIpc(
    () => settingsWindow,
    () => openSettingsWindow()
  );
  setPetWindowGetter(() => petWindow);
  setProactivePetWindowGetter(() => petWindow);
  createPetWindow();
  createTray();

  // 如配置已启用 hook 服务, 自动起
  const cfg = getConfig();
  if (cfg.claudeCode.hookServerEnabled) {
    startBridge().catch(() => {});
  }

  // 启动主动行为 (内部根据 cfg.dailyLetter / cfg.chatter 决定是否真发)
  startProactive();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });
});

app.on('before-quit', () => {
  stopBridge();
  stopProactive();
  closeMemory();
});

// 桌宠常驻 — 不监听 window-all-closed
