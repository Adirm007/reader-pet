// 应用配置持久化层
import Store from 'electron-store';
import { app } from 'electron';
import { homedir } from 'os';
import { join } from 'path';
import type { AppConfig } from '../shared/types';

const userHome = homedir();
const safeWorkdir = join(userHome, 'reader-pet-workspace');

const defaults: AppConfig = {
  providers: [],
  activeProviderId: null,
  activePersonaId: 'reader',
  profile: {
    preferredAddress: '作家先生',
    selfDescription: '',
    customFacts: []
  },
  window: {
    alwaysOnTop: true,
    petSize: 100
  },
  autoLaunch: false,
  safetyMode: 'safe',
  safetyModeLastChangedAt: 0,
  capabilities: {
    fileReadAllowDirs: [safeWorkdir],
    fileWriteAllowDirs: [safeWorkdir],
    // 安全模式下白名单 (常用、低危)
    shellAllowList: ['git', 'npm', 'node', 'python', 'pip', 'echo', 'ls', 'dir', 'pwd', 'cat', 'type'],
    screenCaptureRequireConfirm: true,
    playwrightEnabled: false,
    memoryRWEnabled: false
  },
  claudeCode: {
    hookServerEnabled: false,
    hookServerPort: 7711,
    cliPath: '',
    reportInPersonaVoice: true
  },
  dailyLetter: {
    enabled: true,
    hour: 8
  },
  chatter: {
    enabled: false,
    minMinutes: 20,
    maxMinutes: 240
  },
  tts: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:9880',
    refAudioPath: '',
    promptText: '',
    promptLang: 'zh',
    textLang: 'zh',
    speedFactor: 1.0,
    autoSpeakOnBubble: true
  },
  panel: {
    live2dModelPath: ''
  },
  petSprite: {
    activePackageId: 'yomeko',
    defaultFps: 8,
    fpsMultiplier: 0.6
  },
  memory: {
    graphEnabled: false,
    neo4jUri: 'bolt://127.0.0.1:7687',
    neo4jUser: 'neo4j',
    neo4jPassword: '',
    graphWriteEnabled: false,
    graphRecallEnabled: false,
    digestionEnabled: false,
    graphRecallTimeoutMs: 1200
  }
};

// 延迟初始化, 因为 electron-store 内部要拿 app.getPath('userData')
let _store: Store<AppConfig> | null = null;
function getStore(): Store<AppConfig> {
  if (_store) return _store;
  // 确保 userData 已可用
  if (!app.isReady()) {
    // electron-store 会自己处理, 但 defaults 里有 homedir 路径预填, 这里没问题
  }
  _store = new Store<AppConfig>({
    name: 'reader-pet-config',
    defaults
  });
  return _store;
}

export function getConfig(): AppConfig {
  return getStore().store;
}

export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const s = getStore();
  for (const [k, v] of Object.entries(patch)) {
    (s as any).set(k, v);
  }
  return s.store;
}

export function getActiveProvider() {
  const cfg = getConfig();
  if (!cfg.activeProviderId) return null;
  return cfg.providers.find((p) => p.id === cfg.activeProviderId) ?? null;
}

export function getSafetyMode() {
  return getConfig().safetyMode;
}
