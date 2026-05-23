// Google Gemini (generative language) 适配
// REST: {baseUrl}/v1beta/models/{model}:generateContent?key={apiKey}
// 默认 baseUrl = https://generativelanguage.googleapis.com, 支持反代填写
// 工具调用: 翻译到 Gemini 原生 functionDeclarations / functionCall / functionResponse
import type {
  ProviderConfig,
  ChatRequest,
  ChatResponse,
  ToolDefinition,
  ChatMessage,
  ToolCall
} from '../../shared/types';

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function toGeminiTools(tools: ToolDefinition[] | undefined) {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
      }))
    }
  ];
}

function adaptMessages(messages: ChatMessage[]): { systemInstruction?: any; contents: any[] } {
  const sysParts: string[] = [];
  const contents: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      sysParts.push(m.content);
    } else if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      const parts: any[] = [];
      if (m.content) parts.push({ text: m.content });
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          let args: any = {};
          try {
            args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            args = {};
          }
          parts.push({ functionCall: { name: tc.function.name, args } });
        }
      }
      contents.push({ role: 'model', parts });
    } else if (m.role === 'tool') {
      let payload: any;
      try {
        payload = m.content ? JSON.parse(m.content) : {};
      } catch {
        payload = { result: m.content };
      }
      const part = {
        functionResponse: {
          name: m.name ?? 'tool',
          response: payload
        }
      };
      // Gemini 用 user role 承载 functionResponse
      const last = contents[contents.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.parts) &&
          last.parts.length > 0 && last.parts[0].functionResponse) {
        last.parts.push(part);
      } else {
        contents.push({ role: 'user', parts: [part] });
      }
    }
  }
  const systemInstruction = sysParts.length > 0
    ? { role: 'system', parts: [{ text: sysParts.join('\n\n') }] }
    : undefined;
  return { systemInstruction, contents };
}

export async function chatGemini(
  cfg: ProviderConfig,
  req: ChatRequest
): Promise<ChatResponse> {
  const base = trimSlash(cfg.baseUrl || 'https://generativelanguage.googleapis.com');
  const url = `${base}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  const { systemInstruction, contents } = adaptMessages(req.messages);

  const body: any = {
    contents,
    generationConfig: {
      maxOutputTokens: req.maxTokens ?? 800,
      temperature: req.temperature ?? 0.8
    }
  };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  const tools = toGeminiTools(req.tools);
  if (tools) body.tools = tools;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.extraHeaders ?? {})
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Provider ${cfg.name} HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const data: any = await res.json();
  const cand = data.candidates?.[0];
  const parts: any[] = cand?.content?.parts ?? [];
  let text = '';
  const tool_calls: ToolCall[] = [];
  for (const p of parts) {
    if (typeof p.text === 'string') text += p.text;
    if (p.functionCall) {
      tool_calls.push({
        id: `gem-${tool_calls.length}-${Date.now().toString(36)}`,
        type: 'function',
        function: {
          name: p.functionCall.name,
          arguments: JSON.stringify(p.functionCall.args ?? {})
        }
      });
    }
  }
  return {
    text,
    tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
    finish_reason: cand?.finishReason,
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      cachedInputTokens: data.usageMetadata?.cachedContentTokenCount
    }
  };
}

export async function listModelsGemini(cfg: ProviderConfig): Promise<string[] | null> {
  try {
    const base = trimSlash(cfg.baseUrl || 'https://generativelanguage.googleapis.com');
    const res = await fetch(
      `${base}/v1beta/models?key=${encodeURIComponent(cfg.apiKey)}`,
      { headers: { ...(cfg.extraHeaders ?? {}) } }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const arr = data.models ?? [];
    return arr
      .map((m: any) => {
        const name: string = m.name ?? '';
        return name.replace(/^models\//, '');
      })
      .filter(Boolean);
  } catch {
    return null;
  }
}
