// Provider 工厂 — 当前仅实现 OpenAI 兼容
// 后续 anthropic / gemini 在此 dispatch
import type { ProviderConfig, ChatRequest, ChatResponse } from '../../shared/types';
import { chatOpenAICompatible, listModelsOpenAICompatible } from './openai-compatible';

export async function chat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResponse> {
  switch (cfg.type) {
    case 'openai-compatible':
      return chatOpenAICompatible(cfg, req);
    case 'anthropic':
      throw new Error('Anthropic provider 暂未实现, 下一阶段添加');
    case 'gemini':
      throw new Error('Gemini provider 暂未实现, 下一阶段添加');
    default:
      throw new Error(`未知 provider type: ${(cfg as ProviderConfig).type}`);
  }
}

export async function listModels(cfg: ProviderConfig): Promise<string[] | null> {
  switch (cfg.type) {
    case 'openai-compatible':
      return listModelsOpenAICompatible(cfg);
    default:
      return null;
  }
}
