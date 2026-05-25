// 对话编排 — 把人设/Profile/历史拼成消息, 调 provider, 返回结果
// 工具调用: 进入循环, 直到模型不再请求工具或达到上限
import { getConfig, getActiveProvider } from './config';
import { buildSystemPrompt, INNER_MONOLOGUE_PREFILL, parseInnerMonologue } from './personas-loader';
import { chat as providerChat } from './providers';
import { TOOL_DEFINITIONS, callTool } from './tools';
import { appendEpisode } from './memory/store';
import { buildMemoryContext } from './memory/recall';
import { enqueueDigestEpisodePair, kickMemoryWorker } from './memory/jobs';
import { noteUserInteraction } from './proactive';
import { recordMonologue } from './inner-monologue-log';
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
  const memoryContext = await buildMemoryContext({ userInput, personaId: cfg.activePersonaId });
  const prompt = buildSystemPrompt(
    cfg.activePersonaId,
    cfg.profile,
    memoryContext.facts,
    memoryContext.recentTasks,
    memoryContext.block
  );

  // 把作家的输入包成"信件"投递, 而不是赤裸的 instruction —
  // 让模型把通道感知为"作家↔读者通信", 从根上去除"用户在给 AI 下指令"的形状
  const wrappedUser =
    `<作家寄来的话>\n${userInput}\n</作家寄来的话>`;

  const working: ChatMessage[] = [
    { role: 'system', content: prompt.combined },
    ...recentWindow,
    { role: 'user', content: wrappedUser }
  ];

  let sourceEpisodeId: number | undefined;
  try {
    sourceEpisodeId = appendEpisode({
      ts: Date.now(),
      role: 'user',
      content: userInput,
      persona_id: cfg.activePersonaId
    });
  } catch {
    sourceEpisodeId = undefined;
  }

  let lastResp: ChatResponse | null = null;
  let lastDialog = '';
  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const resp = await providerChat(provider, {
      messages: working,
      maxTokens: 30000,          // 不限制思考长度, 让模型按需展开
      temperature: 0.85,
      tools: TOOL_DEFINITIONS,
      // 每轮都预制独白入口 — 确保每个决策点都有 hidden 思考空间, 自我认知永驻
      prefill: INNER_MONOLOGUE_PREFILL
    });
    lastResp = resp;
    const { monologue, dialog } = parseInnerMonologue(resp.text ?? '');
    lastDialog = dialog;

    // 记录这一轮的独白 (即便没产出对白也记 — 那种情况通常说明她想完直接调工具去了)
    recordMonologue({
      ts: Date.now(),
      source: 'chat',
      persona: cfg.activePersonaId,
      provider: provider.id,
      model: provider.model,
      trigger: turn === 0 ? userInput : `(turn ${turn} · tool 结果继续)`,
      monologue,
      dialog,
      outputTokens: resp.usage?.outputTokens
    });

    const calls = resp.tool_calls ?? [];
    if (calls.length === 0) {
      // 没有工具调用, 结束
      break;
    }
    // 把 assistant 这条 (含 tool_calls) 写入 working — 只保留对白, 独白不进上下文
    working.push({
      role: 'assistant',
      content: dialog,
      tool_calls: calls
    });
    // 依次执行 (并行更快但顺序更稳, 先求稳)
    for (const c of calls) {
      const result = await callTool(c.function.name, c.function.arguments, { sourceEpisodeId });
      working.push({
        role: 'tool',
        tool_call_id: c.id,
        name: c.function.name,
        content: result
      });
    }
    // 进入下一轮, 让模型基于工具结果继续
  }

  const finalText = lastDialog;
  pushRecent({ role: 'user', content: wrappedUser });
  pushRecent({ role: 'assistant', content: finalText });

  let assistantEpisodeId: number | undefined;
  try {
    if (finalText) {
      assistantEpisodeId = appendEpisode({
        ts: Date.now(),
        role: 'assistant',
        content: finalText,
        persona_id: cfg.activePersonaId
      });
    }
  } catch {
    // 记忆持久化失败不影响主流程
  }

  try {
    if (sourceEpisodeId && assistantEpisodeId && cfg.memory.digestionEnabled) {
      enqueueDigestEpisodePair({
        userEpisodeId: sourceEpisodeId,
        assistantEpisodeId,
        personaId: cfg.activePersonaId
      });
      kickMemoryWorker();
    }
  } catch {
    // 后台整理失败不影响主流程
  }

  // 用户刚交互过, 重排话痨计时器避免立即被搭话
  try {
    noteUserInteraction();
  } catch {
    /* ignore */
  }

  // 返回给前端的也是 stripped 版 — 独白不上 UI
  return lastResp ? { ...lastResp, text: finalText } : { text: '' };
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
