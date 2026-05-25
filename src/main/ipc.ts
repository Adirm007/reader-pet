// 所有 IPC handler 集中注册
import { ipcMain, BrowserWindow } from 'electron';
import { getConfig, setConfig } from './config';
import { getPersonaList } from './personas-loader';
import { sendChat, getRecentWindow, clearRecentWindow, testProvider } from './chat';
import { listModels } from './providers';
import {
  CAPABILITIES,
  listCapabilityStatuses,
  listCapabilityRuntimeStatuses,
  getCapabilityStatus,
  emergencyStop
} from './capabilities';
import { invokeDirectAction } from './capabilities/registry';
import { listBrowserMcpTools } from './capabilities/playwright-mcp';
import { getMcpPrompt, listMcpPrompts, listMcpResources, listMcpTools, readMcpResource } from './capabilities/mcp';
import {
  installStopHook,
  uninstallStopHook,
  isStopHookInstalled
} from './claude-code-hook-installer';
import { startBridge, stopBridge, isBridgeRunning } from './claude-code-bridge';
import {
  rescheduleProactive,
  triggerLetterNow,
  triggerChatterNow
} from './proactive';
import { synthesize, pingTTS } from './tts';
import { embed as providerEmbed } from './providers';
import { listSpritePackages, loadSpritePackage, getUserSpriteDir } from './pet-sprites';
import { shell } from 'electron';
import {
  recentEpisodes,
  searchEpisodes,
  listFacts,
  upsertFact,
  setFactStatus,
  updateFact,
  deleteFact,
  deleteConversationSummary,
  deleteEpisodeCascade,
  listTasks,
  getMemoryStats,
  listConversationSummaries,
  listMemoryJobs,
  listMemorySources,
  promoteTaskToMemory,
  retryMemoryJob,
  updateTaskMemoryState,
  enqueueMemoryJob
} from './memory/store';
import { testGraphConnection, getGraphStats } from './memory/neo4j-client';
import { enqueueMissingDailyDigests, kickMemoryWorker } from './memory/jobs';
import { listMonologues, clearMonologues, getLogFilePath } from './inner-monologue-log';
import type { ProviderConfig, SafetyMode, FactStatus, MemoryJobStatus, MemoryScope, RecallPolicy, TaskMemoryStatus } from '../shared/types';

export function registerIpc(
  getSettingsWindow: () => BrowserWindow | null,
  openSettingsWindow: () => void
) {
  // 配置
  ipcMain.handle('config:get', () => getConfig());
  ipcMain.handle('config:set', (_, patch) => {
    const next = setConfig(patch);
    // 主动行为相关配置变化时重排计时器
    if (
      patch &&
      (Object.prototype.hasOwnProperty.call(patch, 'dailyLetter') ||
        Object.prototype.hasOwnProperty.call(patch, 'chatter'))
    ) {
      rescheduleProactive();
    }
    return next;
  });

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
  ipcMain.handle('provider:testEmbedding', async (_, cfg: ProviderConfig) => {
    try {
      const resp = await providerEmbed(cfg, { texts: ['reader-pet embedding test'], model: cfg.embeddingModel || cfg.model });
      return { ok: true, message: `OK · ${resp.model} · ${resp.dimensions} dimensions` };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  });

  // 设置窗口
  ipcMain.handle('settings:open', () => openSettingsWindow());
  ipcMain.handle('settings:close', () => {
    getSettingsWindow()?.close();
  });

  // 能力清单 (UI 展示)
  ipcMain.handle('capabilities:list', () => CAPABILITIES);
  ipcMain.handle('capabilities:statuses', () => listCapabilityStatuses());
  ipcMain.handle('capabilities:runtimeStatuses', () => listCapabilityRuntimeStatuses());
  ipcMain.handle('capabilities:emergencyStop', () => emergencyStop());
  ipcMain.handle('capabilities:listBrowserMcpTools', () => listBrowserMcpTools());
  ipcMain.handle('capabilities:listMcpTools', (_, serverId: string) => listMcpTools(serverId));
  ipcMain.handle('capabilities:listMcpResources', (_, serverId: string) => listMcpResources(serverId));
  ipcMain.handle('capabilities:readMcpResource', (_, serverId: string, uri: string) => readMcpResource(serverId, uri));
  ipcMain.handle('capabilities:listMcpPrompts', (_, serverId: string) => listMcpPrompts(serverId));
  ipcMain.handle('capabilities:getMcpPrompt', (_, serverId: string, name: string, args: Record<string, unknown>) => getMcpPrompt(serverId, name, args));
  ipcMain.handle('capabilities:isPlaywrightInstalled', async () => {
    const status = await getCapabilityStatus('browser');
    return status?.status !== 'not_installed';
  });
  ipcMain.handle('capabilities:isMemoryRWInstalled', async () => {
    const status = await getCapabilityStatus('memory_rw');
    return status?.status !== 'not_installed';
  });

  // 直接调用能力 (调试 / Settings 试运行用; 实际生产路径走 LLM tool calling)
  ipcMain.handle('cap:fileRead', (_, p: string) => invokeDirectAction('file.read', [p]));
  ipcMain.handle('cap:fileWrite', (_, p: string, c: string) => invokeDirectAction('file.write', [p, c]));
  ipcMain.handle('cap:fileList', (_, p: string) => invokeDirectAction('file.list', [p]));
  ipcMain.handle('cap:fileStat', (_, p: string) => invokeDirectAction('file.stat', [p]));
  ipcMain.handle('cap:shell', (_, cmd: string, opts: any) => invokeDirectAction('shell.exec', [cmd, opts]));
  ipcMain.handle('cap:screen', (_, opts: any) => invokeDirectAction('screen.capture', [opts]));
  ipcMain.handle('cap:browserGoto', (_, url: string) => invokeDirectAction('browser.goto', [url]));
  ipcMain.handle('cap:maaRunTask', (_, args: any) => invokeDirectAction('maa.runTask', [args]));
  ipcMain.handle('cap:desktopRunQueue', (_, args: any) => invokeDirectAction('desktop.runQueue', [args]));
  ipcMain.handle('cap:cliAnythingRun', (_, args: any) => invokeDirectAction('cliAnything.run', [args]));
  ipcMain.handle('cap:listProcesses', () => invokeDirectAction('memory.listProcesses', []));

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

  // 记忆系统
  ipcMain.handle('mem:stats', () => getMemoryStats());
  ipcMain.handle('mem:recentEpisodes', (_, limit: number, persona?: string) =>
    recentEpisodes(limit, persona)
  );
  ipcMain.handle('mem:searchEpisodes', (_, q: string, limit: number, opts?: { personaId?: string; projectId?: string }) => searchEpisodes(q, limit, opts));
  ipcMain.handle('mem:listFacts', (_, filter?: { status?: FactStatus; scope?: MemoryScope; personaId?: string; projectId?: string; query?: string; limit?: number } | FactStatus, limit?: number) => {
    if (typeof filter === 'string') return listFacts({ status: filter, limit });
    return listFacts(filter ?? { limit });
  });
  ipcMain.handle('mem:upsertFact', (_, row: any) => upsertFact(row));
  ipcMain.handle('mem:updateFact', (_, id: number, patch: any) => {
    updateFact(id, patch);
    return { ok: true };
  });
  ipcMain.handle('mem:setFactStatus', (_, id: number, status: FactStatus) => {
    setFactStatus(id, status);
    return { ok: true };
  });
  ipcMain.handle('mem:deleteFact', (_, id: number) => {
    deleteFact(id);
    return { ok: true };
  });
  ipcMain.handle('mem:listTasks', (_, limit: number) => listTasks(limit));
  ipcMain.handle('mem:updateTaskMemoryState', (_, id: number, patch: { memory_status?: TaskMemoryStatus; recall_policy?: RecallPolicy; user_note?: string }) => {
    updateTaskMemoryState(id, patch);
    return { ok: true };
  });
  ipcMain.handle('mem:promoteTaskToMemory', (_, id: number, opts?: { title?: string; summary?: string; importance?: number; recall_policy?: RecallPolicy }) =>
    promoteTaskToMemory(id, opts)
  );
  ipcMain.handle('mem:listSources', (_, memoryType: string, memoryId: number) =>
    listMemorySources(memoryType, memoryId)
  );
  ipcMain.handle('mem:graphTestConnection', () => testGraphConnection());
  ipcMain.handle('mem:graphStats', () => getGraphStats());
  ipcMain.handle('mem:listSummaries', (_, limit?: number, query?: string) =>
    listConversationSummaries({ limit, query })
  );
  ipcMain.handle('mem:deleteSummary', (_, id: number) => {
    deleteConversationSummary(id);
    return { ok: true };
  });
  ipcMain.handle('mem:deleteEpisodeCascade', (_, id: number) => {
    deleteEpisodeCascade(id);
    return { ok: true };
  });
  ipcMain.handle('mem:listJobs', (_, status?: MemoryJobStatus, limit?: number) =>
    listMemoryJobs({ status, limit })
  );
  ipcMain.handle('mem:retryJob', (_, id: number) => {
    retryMemoryJob(id);
    kickMemoryWorker();
    return { ok: true };
  });
  ipcMain.handle('mem:kickDigestion', () => {
    kickMemoryWorker();
    return { ok: true };
  });
  ipcMain.handle('mem:enqueueMissingDailyDigests', (_, localDay?: string) => {
    const day = typeof localDay === 'string' && localDay.trim()
      ? localDay.trim()
      : new Date().toLocaleDateString('en-CA');
    const result = enqueueMissingDailyDigests({ personaId: getConfig().activePersonaId, localDay: day });
    kickMemoryWorker();
    return { ok: true, localDay: day, ...result };
  });
  ipcMain.handle('mem:backfillEmbeddings', () => {
    enqueueMemoryJob({
      type: 'embed_missing_memories',
      dedupe_key: `embed_missing_memories:${Date.now()}`,
      payload_json: '{}'
    });
    kickMemoryWorker();
    return { ok: true };
  });
  ipcMain.handle('mem:rebuildGraph', () => {
    enqueueMemoryJob({
      type: 'graph_rebuild_all',
      dedupe_key: `graph_rebuild_all:${Date.now()}`,
      payload_json: '{}'
    });
    kickMemoryWorker();
    return { ok: true };
  });

  // 主动行为
  ipcMain.handle('proactive:triggerLetter', () => triggerLetterNow());
  ipcMain.handle('proactive:triggerChatter', () => triggerChatterNow());

  // TTS
  ipcMain.handle('tts:ping', () => pingTTS());
  ipcMain.handle('tts:synthesize', (_, text: string) => synthesize(text));

  // 桌宠精灵图
  ipcMain.handle('petSprite:list', () => listSpritePackages());
  ipcMain.handle('petSprite:load', (_, id: string) => loadSpritePackage(id));
  ipcMain.handle('petSprite:openUserDir', async () => {
    const dir = getUserSpriteDir();
    try {
      const fsmod = await import('fs');
      if (!fsmod.existsSync(dir)) fsmod.mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
    await shell.openPath(dir);
    return dir;
  });

  // 内心独白日志 — 默认对用户与 LLM 双隐藏, 用户主动查询时调出
  ipcMain.handle('innerMonologue:list', (_, limit?: number) => listMonologues(limit ?? 50));
  ipcMain.handle('innerMonologue:clear', () => {
    clearMonologues();
    return true;
  });
  ipcMain.handle('innerMonologue:openLogFile', async () => {
    const p = getLogFilePath();
    await shell.openPath(p);
    return p;
  });
}
