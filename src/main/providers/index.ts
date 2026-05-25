// Provider 工厂 — 三种类型分发: openai-compatible / anthropic / gemini
import type { ProviderConfig, ChatRequest, ChatResponse, EmbeddingRequest, EmbeddingResponse } from '../../shared/types';
import { chatOpenAICompatible, embedOpenAICompatible, listModelsOpenAICompatible } from './openai-compatible';
import { chatAnthropic, embedAnthropic, listModelsAnthropic } from './anthropic';
import { chatGemini, embedGemini, listModelsGemini } from './gemini';

export async function chat(cfg: ProviderConfig, req: ChatRequest): Promise<ChatResponse> {
  switch (cfg.type) {
    case 'openai-compatible':
      return chatOpenAICompatible(cfg, req);
    case 'anthropic':
      return chatAnthropic(cfg, req);
    case 'gemini':
      return chatGemini(cfg, req);
    default:
      throw new Error(`未知 provider type: ${(cfg as ProviderConfig).type}`);
  }
}

export async function listModels(cfg: ProviderConfig): Promise<string[] | null> {
  switch (cfg.type) {
    case 'openai-compatible':
      return listModelsOpenAICompatible(cfg);
    case 'anthropic':
      return listModelsAnthropic(cfg);
    case 'gemini':
      return listModelsGemini(cfg);
    default:
      return null;
  }
}

export async function embed(cfg: ProviderConfig, req: EmbeddingRequest): Promise<EmbeddingResponse> {
  switch (cfg.type) {
    case 'openai-compatible':
      return embedOpenAICompatible(cfg, req);
    case 'anthropic':
      return embedAnthropic(cfg, req);
    case 'gemini':
      return embedGemini(cfg, req);
    default:
      throw new Error(`未知 provider type: ${(cfg as ProviderConfig).type}`);
  }
}
