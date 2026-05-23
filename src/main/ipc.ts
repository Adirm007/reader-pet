// 所有 IPC handler 集中注册
import { ipcMain, BrowserWindow } from 'electron';
import { getConfig, setConfig } from './config';
import { getPersonaList } from './personas-loader';
import { sendChat, getRecentWindow, clearRecentWindow, testProvider } from './chat';
import { listModels } from './providers';
import type { ProviderConfig } from '../shared/types';

export function registerIpc(getSettingsWindow: () => BrowserWindow | null,
                            openSettingsWindow: () => void) {
  ipcMain.handle('config:get', () => getConfig());
  ipcMain.handle('config:set', (_, patch) => setConfig(patch));

  ipcMain.handle('personas:list', () => getPersonaList());

  ipcMain.handle('chat:send', async (_, input: string) => {
    return sendChat(input);
  });
  ipcMain.handle('chat:recent', () => getRecentWindow());
  ipcMain.handle('chat:clear', () => {
    clearRecentWindow();
  });

  ipcMain.handle('provider:test', (_, id: string) => testProvider(id));
  ipcMain.handle('provider:listModels', async (_, cfg: ProviderConfig) => listModels(cfg));

  ipcMain.handle('settings:open', () => openSettingsWindow());
  ipcMain.handle('settings:close', () => {
    getSettingsWindow()?.close();
  });
}
