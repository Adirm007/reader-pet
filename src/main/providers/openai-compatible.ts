// OpenAI 兼容协议适配器
// 覆盖: OpenAI 官方 / DeepSeek / Qwen / Moonshot / 智谱 / Ollama / LM Studio / 各反代
import type { ProviderConfig, ChatRequest, ChatResponse } from '../../shared/types';

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

export async function chatOpenAICompatible(
  cfg: ProviderConfig,
  req: ChatRequest
): Promise<ChatResponse> {
  const url = `${trimSlash(cfg.baseUrl)}/chat/completions`;
  const body = {
    model: cfg.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: req.maxTokens ?? 800,
    temperature: req.temperature ?? 0.8,
    stream: false
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      ...(cfg.extraHeaders ?? {})
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Provider ${cfg.name} HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const data: any = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';
  return {
    text,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      cachedInputTokens: data.usage?.prompt_tokens_details?.cached_tokens
    }
  };
}

// 模型列表查询 (GET /v1/models) — 不是所有兼容端都实现, 失败时返回 null
export async function listModelsOpenAICompatible(cfg: ProviderConfig): Promise<string[] | null> {
  try {
    const res = await fetch(`${trimSlash(cfg.baseUrl)}/models`, {
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        ...(cfg.extraHeaders ?? {})
      }
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const list = data.data ?? data.models ?? [];
    return list.map((m: any) => m.id ?? m.name).filter(Boolean);
  } catch {
    return null;
  }
}
