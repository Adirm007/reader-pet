// Anthropic Messages API 适配
// 走 fetch 直连, baseUrl 默认 https://api.anthropic.com, 支持反代填写自定义 baseUrl
// 工具调用: 把 OAI 的 ToolDefinition / ChatMessage(tool_calls/role=tool) 翻译到 Anthropic 原生 tool_use / tool_result
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

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: any;
}

function toAnthropicTools(tools: ToolDefinition[] | undefined) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters
  }));
}

// 把 OAI 风格的 messages 转成 Anthropic 风格 (system 抽离, tool_calls/tool 角色映射)
function adaptMessages(messages: ChatMessage[]): {
  system: string;
  list: { role: 'user' | 'assistant'; content: any }[];
} {
  const sysParts: string[] = [];
  const list: { role: 'user' | 'assistant'; content: any }[] = [];
  // 先把 system 收集
  for (const m of messages) {
    if (m.role === 'system') sysParts.push(m.content);
  }
  // 处理 user / assistant / tool, 注意 OAI 的 tool 消息要并入 user content 作为 tool_result
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      list.push({ role: 'user', content: [{ type: 'text', text: m.content }] });
    } else if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          let input: any = {};
          try {
            input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            input = { _raw: tc.function.arguments };
          }
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
        }
      }
      list.push({ role: 'assistant', content: blocks });
    } else if (m.role === 'tool') {
      // 合并连续的 tool 消息成一条 user 消息 (Anthropic 要求 tool_result 块在 user 消息里)
      const last = list[list.length - 1];
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id ?? '',
        content: m.content
      };
      if (last && last.role === 'user' && Array.isArray(last.content) &&
          last.content.length > 0 && last.content[0].type === 'tool_result') {
        last.content.push(block);
      } else {
        list.push({ role: 'user', content: [block] });
      }
    }
  }
  return { system: sysParts.join('\n\n'), list };
}

export async function chatAnthropic(
  cfg: ProviderConfig,
  req: ChatRequest
): Promise<ChatResponse> {
  const base = trimSlash(cfg.baseUrl || 'https://api.anthropic.com');
  const url = `${base}/v1/messages`;
  const { system, list } = adaptMessages(req.messages);

  const body: any = {
    model: cfg.model,
    max_tokens: req.maxTokens ?? 800,
    temperature: req.temperature ?? 0.8,
    messages: list
  };
  if (system) body.system = system;
  const tools = toAnthropicTools(req.tools);
  if (tools) body.tools = tools;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      // 反代有的需要 Bearer (兼容写法)
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
  const blocks: AnthropicContentBlock[] = data.content ?? [];
  let text = '';
  const tool_calls: ToolCall[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && b.text) text += b.text;
    if (b.type === 'tool_use') {
      tool_calls.push({
        id: b.id ?? '',
        type: 'function',
        function: {
          name: b.name ?? '',
          arguments: JSON.stringify(b.input ?? {})
        }
      });
    }
  }
  return {
    text,
    tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
    finish_reason: data.stop_reason,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      cachedInputTokens: data.usage?.cache_read_input_tokens
    }
  };
}

// Anthropic 没有 /v1/models 标准接口 (有但需要 admin key); 我们直接返回 null, 让用户手填
export async function listModelsAnthropic(_cfg: ProviderConfig): Promise<string[] | null> {
  return null;
}
