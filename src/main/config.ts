// 应用配置持久化层 — 包一层 electron-store
import Store from 'electron-store';
import type { AppConfig } from '../shared/types';

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
  }
};

const store = new Store<AppConfig>({
  name: 'reader-pet-config',
  defaults
});

export function getConfig(): AppConfig {
  return store.store;
}

export function setConfig(patch: Partial<AppConfig>): AppConfig {
  for (const [k, v] of Object.entries(patch)) {
    (store as any).set(k, v);
  }
  return store.store;
}

export function getActiveProvider() {
  const cfg = getConfig();
  if (!cfg.activeProviderId) return null;
  return cfg.providers.find((p) => p.id === cfg.activeProviderId) ?? null;
}
