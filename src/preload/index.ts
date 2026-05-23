// preload — context bridge 暴露主进程能力给渲染端
import { contextBridge, ipcRenderer } from 'electron';
import type { AppConfig, ChatResponse, PersonaMeta, ProviderConfig } from '../shared/types';

const api = {
  // 配置
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (patch: Partial<AppConfig>): Promise<AppConfig> =>
    ipcRenderer.invoke('config:set', patch),

  // 人设
  listPersonas: (): Promise<PersonaMeta[]> => ipcRenderer.invoke('personas:list'),

  // 对话
  sendChat: (input: string): Promise<ChatResponse> => ipcRenderer.invoke('chat:send', input),
  getRecent: () => ipcRenderer.invoke('chat:recent'),
  clearRecent: () => ipcRenderer.invoke('chat:clear'),

  // Provider
  testProvider: (id: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('provider:test', id),
  listProviderModels: (cfg: ProviderConfig): Promise<string[] | null> =>
    ipcRenderer.invoke('provider:listModels', cfg),

  // 窗口
  hidePet: () => ipcRenderer.invoke('pet:hide'),
  quitApp: () => ipcRenderer.invoke('pet:quit'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  closeSettings: () => ipcRenderer.invoke('settings:close'),
  reloadPetWindow: () => ipcRenderer.invoke('window:reload-pet')
};

contextBridge.exposeInMainWorld('api', api);

export type PetAPI = typeof api;
