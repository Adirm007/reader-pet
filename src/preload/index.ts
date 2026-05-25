// preload — context bridge 暴露主进程能力给渲染端
import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  CapabilityDescriptor,
  CapabilityRuntimeStatus,
  CapabilityStatus,
  ChatResponse,
  ConversationSummaryRow,
  EpisodeRow,
  FactRow,
  FactStatus,
  MemoryJobRow,
  MemoryScope,
  MemoryJobStatus,
  MemorySourceRow,
  MemoryStats,
  PersonaMeta,
  PetSpritePackage,
  ProviderConfig,
  RecallPolicy,
  SafetyMode,
  TaskMemoryStatus,
  TaskRow
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
  testProviderEmbedding: (cfg: ProviderConfig): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('provider:testEmbedding', cfg),

  // 窗口
  hidePet: () => ipcRenderer.invoke('pet:hide'),
  quitApp: () => ipcRenderer.invoke('pet:quit'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  closeSettings: () => ipcRenderer.invoke('settings:close'),
  reloadPetWindow: () => ipcRenderer.invoke('window:reload-pet'),
  petStartDrag: () => ipcRenderer.invoke('pet:startDrag'),
  petEndDrag: () => ipcRenderer.invoke('pet:endDrag'),

  // 能力
  listCapabilities: (): Promise<CapabilityDescriptor[]> =>
    ipcRenderer.invoke('capabilities:list'),
  listCapabilityStatuses: (): Promise<CapabilityStatus[]> =>
    ipcRenderer.invoke('capabilities:statuses'),
  listCapabilityRuntimeStatuses: (): Promise<CapabilityRuntimeStatus[]> =>
    ipcRenderer.invoke('capabilities:runtimeStatuses'),
  emergencyStop: (): Promise<{ ok: boolean; stopped: string[]; idle: string[]; errors: Array<{ id: string; error: string }> }> =>
    ipcRenderer.invoke('capabilities:emergencyStop'),
  listBrowserMcpTools: (): Promise<any[]> =>
    ipcRenderer.invoke('capabilities:listBrowserMcpTools'),
  listMcpTools: (serverId: string): Promise<any[]> =>
    ipcRenderer.invoke('capabilities:listMcpTools', serverId),
  listMcpResources: (serverId: string): Promise<any[]> =>
    ipcRenderer.invoke('capabilities:listMcpResources', serverId),
  readMcpResource: (serverId: string, uri: string): Promise<unknown> =>
    ipcRenderer.invoke('capabilities:readMcpResource', serverId, uri),
  listMcpPrompts: (serverId: string): Promise<any[]> =>
    ipcRenderer.invoke('capabilities:listMcpPrompts', serverId),
  getMcpPrompt: (serverId: string, name: string, args?: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('capabilities:getMcpPrompt', serverId, name, args ?? {}),
  isPlaywrightInstalled: (): Promise<boolean> =>
    ipcRenderer.invoke('capabilities:isPlaywrightInstalled'),
  isMemoryRWInstalled: (): Promise<boolean> =>
    ipcRenderer.invoke('capabilities:isMemoryRWInstalled'),
  maaRunTask: (args: { task?: string; profile?: string; extraArgs?: string[]; timeoutMs?: number }): Promise<unknown> =>
    ipcRenderer.invoke('cap:maaRunTask', args),
  desktopRunQueue: (args: { actions: unknown[]; dryRun?: boolean; description?: string }): Promise<unknown> =>
    ipcRenderer.invoke('cap:desktopRunQueue', args),
  cliAnythingRun: (args: { input: Record<string, unknown>; schema?: unknown; timeoutMs?: number }): Promise<unknown> =>
    ipcRenderer.invoke('cap:cliAnythingRun', args),

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
  onPetBubble: (cb: (payload: { text: string; kind: 'task-report' | 'info' | 'daily-letter' | 'chatter' | 'memory-error' | string; ts: number }) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload);
    ipcRenderer.on('pet:bubble', listener);
    return () => ipcRenderer.off('pet:bubble', listener);
  },

  // 记忆系统
  memStats: (): Promise<MemoryStats> => ipcRenderer.invoke('mem:stats'),
  memRecentEpisodes: (limit: number, persona?: string): Promise<EpisodeRow[]> =>
    ipcRenderer.invoke('mem:recentEpisodes', limit, persona),
  memSearchEpisodes: (q: string, limit: number, opts?: { personaId?: string; projectId?: string }): Promise<EpisodeRow[]> =>
    ipcRenderer.invoke('mem:searchEpisodes', q, limit, opts),
  memListFacts: (filter?: { status?: FactStatus; scope?: MemoryScope; personaId?: string; projectId?: string; query?: string; limit?: number } | FactStatus, limit?: number): Promise<FactRow[]> =>
    ipcRenderer.invoke('mem:listFacts', filter, limit),
  memUpsertFact: (row: {
    predicate: string;
    subject: string;
    object: string;
    confidence?: number;
    scope?: MemoryScope;
    persona_id?: string;
    project_id?: string;
    recall_policy?: RecallPolicy;
  }): Promise<{ id: number; supersededId?: number }> =>
    ipcRenderer.invoke('mem:upsertFact', row),
  memUpdateFact: (id: number, patch: Partial<Pick<FactRow, 'predicate' | 'subject' | 'object' | 'confidence' | 'status' | 'cardinality' | 'scope' | 'persona_id' | 'project_id' | 'recall_policy'>>): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('mem:updateFact', id, patch),
  memSetFactStatus: (id: number, status: FactStatus): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('mem:setFactStatus', id, status),
  memDeleteFact: (id: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('mem:deleteFact', id),
  memListTasks: (limit: number): Promise<TaskRow[]> => ipcRenderer.invoke('mem:listTasks', limit),
  memUpdateTaskMemoryState: (
    id: number,
    patch: { memory_status?: TaskMemoryStatus; recall_policy?: RecallPolicy; user_note?: string }
  ): Promise<{ ok: boolean }> => ipcRenderer.invoke('mem:updateTaskMemoryState', id, patch),
  memPromoteTaskToMemory: (
    id: number,
    opts?: { title?: string; summary?: string; importance?: number; recall_policy?: RecallPolicy }
  ): Promise<{ ok: boolean; summaryId: number }> => ipcRenderer.invoke('mem:promoteTaskToMemory', id, opts),
  memListSources: (memoryType: string, memoryId: number): Promise<MemorySourceRow[]> =>
    ipcRenderer.invoke('mem:listSources', memoryType, memoryId),
  memGraphTestConnection: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('mem:graphTestConnection'),
  memGraphStats: (): Promise<{
    ok: boolean;
    nodes?: number;
    relationships?: number;
    message?: string;
  }> => ipcRenderer.invoke('mem:graphStats'),
  memListSummaries: (limit?: number, query?: string): Promise<ConversationSummaryRow[]> =>
    ipcRenderer.invoke('mem:listSummaries', limit, query),
  memDeleteSummary: (id: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('mem:deleteSummary', id),
  memDeleteEpisodeCascade: (id: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('mem:deleteEpisodeCascade', id),
  memListJobs: (status?: MemoryJobStatus, limit?: number): Promise<MemoryJobRow[]> =>
    ipcRenderer.invoke('mem:listJobs', status, limit),
  memRetryJob: (id: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('mem:retryJob', id),
  memKickDigestion: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('mem:kickDigestion'),
  memEnqueueMissingDailyDigests: (localDay?: string): Promise<{ ok: boolean; localDay: string; enqueued: number; ranges: Array<{ episodeStartId: number; episodeEndId: number }> }> =>
    ipcRenderer.invoke('mem:enqueueMissingDailyDigests', localDay),
  memBackfillEmbeddings: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('mem:backfillEmbeddings'),
  memRebuildGraph: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('mem:rebuildGraph'),

  // 主动行为
  triggerLetter: (): Promise<{ ok: boolean; text?: string; reason?: string }> =>
    ipcRenderer.invoke('proactive:triggerLetter'),
  triggerChatter: (): Promise<{ ok: boolean; text?: string; reason?: string }> =>
    ipcRenderer.invoke('proactive:triggerChatter'),

  // TTS
  ttsPing: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('tts:ping'),
  ttsSynthesize: (
    text: string
  ): Promise<{ ok: boolean; base64?: string; mime?: string; reason?: string }> =>
    ipcRenderer.invoke('tts:synthesize', text),

  // 全屏面板
  openPanel: () => ipcRenderer.invoke('panel:open'),
  closePanel: () => ipcRenderer.invoke('panel:close'),
  loadLive2dAsset: (
    p: string
  ): Promise<{ ok: boolean; dataUrl?: string; reason?: string }> =>
    ipcRenderer.invoke('panel:loadLive2dAsset', p),

  // 开机自启
  setAutoLaunch: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('autoLaunch:set', enabled),
  getAutoLaunch: (): Promise<boolean> => ipcRenderer.invoke('autoLaunch:get'),

  // 桌宠精灵图
  petSpriteList: (): Promise<Array<{ id: string; displayName: string; description?: string }>> =>
    ipcRenderer.invoke('petSprite:list'),
  petSpriteLoad: (id: string): Promise<PetSpritePackage | null> =>
    ipcRenderer.invoke('petSprite:load', id),
  petSpriteOpenUserDir: (): Promise<string> => ipcRenderer.invoke('petSprite:openUserDir'),

  // 内心独白 (默认对用户隐藏, 主动调出来看)
  innerMonologueList: (
    limit?: number
  ): Promise<
    Array<{
      ts: number;
      source: 'chat' | 'chatter' | 'letter' | 'task-report';
      persona: string;
      provider: string;
      model: string;
      trigger?: string;
      monologue: string;
      dialog: string;
      outputTokens?: number;
    }>
  > => ipcRenderer.invoke('innerMonologue:list', limit),
  innerMonologueClear: (): Promise<boolean> => ipcRenderer.invoke('innerMonologue:clear'),
  innerMonologueOpenLogFile: (): Promise<string> =>
    ipcRenderer.invoke('innerMonologue:openLogFile')
};

contextBridge.exposeInMainWorld('api', api);

export type PetAPI = typeof api;
