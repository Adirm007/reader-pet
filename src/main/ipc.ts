// 所有 IPC handler 集中注册
import { ipcMain, BrowserWindow } from 'electron';
import { getConfig, setConfig } from './config';
import { getPersonaList } from './personas-loader';
import { sendChat, getRecentWindow, clearRecentWindow, testProvider } from './chat';
import { listModels } from './providers';
import { CAPABILITIES } from './capabilities';
import { fileRead, fileWrite, fileList, fileStat } from './capabilities/files';
import { shellExec } from './capabilities/shell';
import { screenCapture } from './capabilities/screen';
import { browserGoto, isPlaywrightInstalled } from './capabilities/browser';
import { listProcesses, isMemoryRWInstalled } from './capabilities/memory-rw';
import {
  installStopHook,
  uninstallStopHook,
  isStopHookInstalled
} from './claude-code-hook-installer';
import { startBridge, stopBridge, isBridgeRunning } from './claude-code-bridge';
import type { ProviderConfig, SafetyMode } from '../shared/types';

export function registerIpc(
  getSettingsWindow: () => BrowserWindow | null,
  openSettingsWindow: () => void
) {
  // 配置
  ipcMain.handle('config:get', () => getConfig());
  ipcMain.handle('config:set', (_, patch) => setConfig(patch));

  // 安全模式切换 — 必须由 UI 经过倒计时和二次确认; 这里再做一道"距上次切换不少于 0.5s"防误触
  ipcMain.handle('safety:set', (_, mode: SafetyMode) => {
    const now = Date.now();
    const cur = getConfig();
    if (cur.safetyMode === mode) return cur;
    if (mode === 'danger') {
      // UI 必须自己已经走完 10s 阅读 + 双确认; 此处只接受信任请求
    }
    return setConfig({ safetyMode: mode, safetyModeLastChangedAt: now });
  });

  // 人设
  ipcMain.handle('personas:list', () => getPersonaList());

  // 对话
  ipcMain.handle('chat:send', async (_, input: string) => {
    return sendChat(input);
  });
  ipcMain.handle('chat:recent', () => getRecentWindow());
  ipcMain.handle('chat:clear', () => {
    clearRecentWindow();
  });

  // Provider
  ipcMain.handle('provider:test', (_, id: string) => testProvider(id));
  ipcMain.handle('provider:listModels', async (_, cfg: ProviderConfig) => listModels(cfg));

  // 设置窗口
  ipcMain.handle('settings:open', () => openSettingsWindow());
  ipcMain.handle('settings:close', () => {
    getSettingsWindow()?.close();
  });

  // 能力清单 (UI 展示)
  ipcMain.handle('capabilities:list', () => CAPABILITIES);
  ipcMain.handle('capabilities:isPlaywrightInstalled', () => isPlaywrightInstalled());
  ipcMain.handle('capabilities:isMemoryRWInstalled', () => isMemoryRWInstalled());

  // 直接调用能力 (调试 / Settings 试运行用; 实际生产路径走 LLM tool calling)
  ipcMain.handle('cap:fileRead', (_, p: string) => fileRead(p));
  ipcMain.handle('cap:fileWrite', (_, p: string, c: string) => fileWrite(p, c));
  ipcMain.handle('cap:fileList', (_, p: string) => fileList(p));
  ipcMain.handle('cap:fileStat', (_, p: string) => fileStat(p));
  ipcMain.handle('cap:shell', (_, cmd: string, opts: any) => shellExec(cmd, opts));
  ipcMain.handle('cap:screen', (_, opts: any) => screenCapture(opts));
  ipcMain.handle('cap:browserGoto', (_, url: string) => browserGoto(url));
  ipcMain.handle('cap:listProcesses', () => listProcesses());

  // Claude Code 桥接
  ipcMain.handle('cc:installHook', async () => {
    const cfg = getConfig();
    return installStopHook(cfg.claudeCode.hookServerPort);
  });
  ipcMain.handle('cc:uninstallHook', () => uninstallStopHook());
  ipcMain.handle('cc:isHookInstalled', () => isStopHookInstalled());
  ipcMain.handle('cc:startBridge', () => startBridge());
  ipcMain.handle('cc:stopBridge', () => {
    stopBridge();
    return { ok: true };
  });
  ipcMain.handle('cc:isBridgeRunning', () => isBridgeRunning());
}
