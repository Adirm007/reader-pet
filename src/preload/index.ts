// preload — context bridge 暴露主进程能力给渲染端
import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  CapabilityDescriptor,
  ChatResponse,
  PersonaMeta,
  ProviderConfig,
  SafetyMode
} from '../shared/types';

const api = {
  // 配置
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  setConfig: (patch: Partial<AppConfig>): Promise<AppConfig> =>
    ipcRenderer.invoke('config:set', patch),

  // 安全模式
  setSafetyMode: (mode: SafetyMode): Promise<AppConfig> =>
    ipcRenderer.invoke('safety:set', mode),

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
  reloadPetWindow: () => ipcRenderer.invoke('window:reload-pet'),

  // 能力
  listCapabilities: (): Promise<CapabilityDescriptor[]> =>
    ipcRenderer.invoke('capabilities:list'),
  isPlaywrightInstalled: (): Promise<boolean> =>
    ipcRenderer.invoke('capabilities:isPlaywrightInstalled'),
  isMemoryRWInstalled: (): Promise<boolean> =>
    ipcRenderer.invoke('capabilities:isMemoryRWInstalled'),

  // Claude Code
  ccInstallHook: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('cc:installHook'),
  ccUninstallHook: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('cc:uninstallHook'),
  ccIsHookInstalled: (): Promise<boolean> => ipcRenderer.invoke('cc:isHookInstalled'),
  ccStartBridge: (): Promise<{ ok: boolean; port?: number; reason?: string }> =>
    ipcRenderer.invoke('cc:startBridge'),
  ccStopBridge: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('cc:stopBridge'),
  ccIsBridgeRunning: (): Promise<boolean> => ipcRenderer.invoke('cc:isBridgeRunning'),

  // 桌宠气泡推送 (主进程 → 渲染)
  onPetBubble: (cb: (payload: { text: string; kind: string; ts: number }) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload);
    ipcRenderer.on('pet:bubble', listener);
    return () => ipcRenderer.off('pet:bubble', listener);
  }
};

contextBridge.exposeInMainWorld('api', api);

export type PetAPI = typeof api;
