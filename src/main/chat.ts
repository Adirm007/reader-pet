// 对话编排 — 把人设/Profile/历史拼成消息, 调 provider, 返回结果
// 工具调用: 进入循环, 直到模型不再请求工具或达到上限
import { getConfig, getActiveProvider } from './config';
import { buildSystemPrompt } from './personas-loader';
import { chat as providerChat } from './providers';
import { TOOL_DEFINITIONS, callTool } from './tools';
import type { ChatMessage, ChatResponse } from '../shared/types';

const recentWindow: ChatMessage[] = [];
const RECENT_LIMIT = 20;
const MAX_TOOL_TURNS = 5;

function pushRecent(msg: ChatMessage) {
  recentWindow.push(msg);
  while (recentWindow.length > RECENT_LIMIT) recentWindow.shift();
}

export async function sendChat(userInput: string): Promise<ChatResponse> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error('尚未配置 API provider, 请先到设置面板添加并选定一个 provider');
  }
  const cfg = getConfig();
  const prompt = buildSystemPrompt(cfg.activePersonaId, cfg.profile);

  const working: ChatMessage[] = [
    { role: 'system', content: prompt.combined },
    ...recentWindow,
    { role: 'user', content: userInput }
  ];

  let lastResp: ChatResponse | null = null;
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const resp = await providerChat(provider, {
      messages: working,
      maxTokens: 800,
      temperature: 0.85,
      tools: TOOL_DEFINITIONS
    });
    lastResp = resp;
    const calls = resp.tool_calls ?? [];
    if (calls.length === 0) {
      // 没有工具调用, 结束
      break;
    }
    // 把 assistant 这条 (含 tool_calls) 写入 working
    working.push({
      role: 'assistant',
      content: resp.text ?? '',
      tool_calls: calls
    });
    // 依次执行 (并行更快但顺序更稳, 先求稳)
    for (const c of calls) {
      const result = await callTool(c.function.name, c.function.arguments);
      working.push({
        role: 'tool',
        tool_call_id: c.id,
        name: c.function.name,
        content: result
      });
    }
    // 进入下一轮, 让模型基于工具结果继续
  }

  const finalText = lastResp?.text ?? '';
  pushRecent({ role: 'user', content: userInput });
  pushRecent({ role: 'assistant', content: finalText });

  return lastResp ?? { text: '' };
}

export function getRecentWindow(): ChatMessage[] {
  return [...recentWindow];
}

export function clearRecentWindow() {
  recentWindow.length = 0;
}

// 简单连通测试 — 用于设置面板的 "测试" 按钮
export async function testProvider(providerId: string): Promise<{ ok: boolean; message: string }> {
  const cfg = getConfig();
  const p = cfg.providers.find((x) => x.id === providerId);
  if (!p) return { ok: false, message: 'provider 不存在' };
  try {
    const resp = await providerChat(p, {
      messages: [
        { role: 'system', content: '你是测试用 echo, 直接简短回复用户的话即可' },
        { role: 'user', content: 'ping' }
      ],
      maxTokens: 30,
      temperature: 0
    });
    return {
      ok: true,
      message: `OK · 模型回复: "${resp.text.trim().slice(0, 80)}"`
    };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? String(e) };
  }
}
