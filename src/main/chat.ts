// 对话编排 — 把人设/Profile/历史拼成消息, 调 provider, 返回结果
// 当前阶段先不接记忆系统 (五层架构在下一阶段实现); 只维护一个进程内最近窗口
import { getConfig, getActiveProvider } from './config';
import { buildSystemPrompt } from './personas-loader';
import { chat as providerChat } from './providers';
import type { ChatMessage, ChatResponse } from '../shared/types';

const recentWindow: ChatMessage[] = [];
const RECENT_LIMIT = 20;

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

  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.combined },
    ...recentWindow,
    { role: 'user', content: userInput }
  ];

  const resp = await providerChat(provider, {
    messages,
    maxTokens: 800,
    temperature: 0.85
  });

  pushRecent({ role: 'user', content: userInput });
  pushRecent({ role: 'assistant', content: resp.text });

  return resp;
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
