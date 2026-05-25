// OpenAI 兼容协议适配器
// 覆盖: OpenAI 官方 / DeepSeek / Qwen / Moonshot / 智谱 / Ollama / LM Studio / 各反代
import type { ProviderConfig, ChatRequest, ChatResponse, ChatMessage } from '../../shared/types';

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function serializeMessage(m: ChatMessage): any {
  const base: any = { role: m.role };
  if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
    base.content = m.content ?? '';
    base.tool_calls = m.tool_calls;
    return base;
  }
  if (m.role === 'tool') {
    base.content = m.content;
    base.tool_call_id = m.tool_call_id;
    if (m.name) base.name = m.name;
    return base;
  }
  base.content = m.content;
  return base;
}

export async function chatOpenAICompatible(
  cfg: ProviderConfig,
  req: ChatRequest
): Promise<ChatResponse> {
  const url = `${trimSlash(cfg.baseUrl)}/chat/completions`;
  const messages = req.messages.map(serializeMessage);
  // Prefill — OAI 协议没标准化, 但实测大多兼容端 (DeepSeek/Qwen/智谱/Moonshot/Ollama/LM Studio)
  // 会把"末尾 assistant 消息"当作前缀续写. DeepSeek 额外认 prefix:true (无害于其它端).
  if (req.prefill) {
    messages.push({ role: 'assistant', content: req.prefill, prefix: true });
  }
  const body: any = {
    model: cfg.model,
    messages,
    max_tokens: req.maxTokens ?? 800,
    temperature: req.temperature ?? 0.8,
    stream: false
  };
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools;
    body.tool_choice = 'auto';
  }
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
  const choice = data.choices?.[0];
  const msg = choice?.message ?? {};
  const text: string = msg.content ?? '';
  const tool_calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : undefined;
  // 不在此处拼回 prefill — 上层 stripInnerMonologue 已能处理"只剩闭合 tag"的 DeepSeek 续写格式,
  // 也能处理"完全没 tag"的非续写型服务器. 主动拼回反而会在不支持 prefix 的服务器上制造畸形输出.
  return {
    text,
    tool_calls,
    finish_reason: choice?.finish_reason,
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
