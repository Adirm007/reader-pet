// 主动行为 — 一天一封信 + 话痨模式
//
// 设计要点:
//   - 两个独立计时器, 互不干涉
//   - daily letter: 每日 cfg.dailyLetter.hour 大致时段 (随机 0~50 分偏移, 避免整点)
//     一天最多发一封 (按本地日期去重, 持久化到 electron-store 一个旁路 key)
//   - chatter: 每次随机 [minMinutes, maxMinutes] 后触发, 触发后再次随机重排
//   - 都通过 pet:bubble IPC 推到桌宠气泡
//   - token 经济: 仅在 provider 已配置 + 桌宠窗口存在时才调模型
//   - 用户改设置时, 调用 reschedule() 让计时器重新读取最新配置
import { BrowserWindow } from 'electron';
import Store from 'electron-store';
import { getConfig, getActiveProvider } from './config';
import { buildSystemPrompt, loadPersonas } from './personas-loader';
import { chat as providerChat } from './providers';
import { recentEpisodes, listFacts } from './memory/store';
import type { ChatMessage } from '../shared/types';

interface ProactiveState {
  lastLetterDate: string;     // YYYY-MM-DD (本地)
  lastChatterAt: number;      // ms
}

let stateStore: Store<ProactiveState> | null = null;
function getStateStore(): Store<ProactiveState> {
  if (stateStore) return stateStore;
  stateStore = new Store<ProactiveState>({
    name: 'reader-pet-proactive',
    defaults: { lastLetterDate: '', lastChatterAt: 0 }
  });
  return stateStore;
}

let letterTimer: NodeJS.Timeout | null = null;
let chatterTimer: NodeJS.Timeout | null = null;
let getPetWindow: () => BrowserWindow | null = () => null;

export function setProactivePetWindowGetter(fn: () => BrowserWindow | null) {
  getPetWindow = fn;
}

function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pushBubble(text: string, kind: 'daily-letter' | 'chatter') {
  const win = getPetWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('pet:bubble', { text, kind, ts: Date.now() });
  if (!win.isVisible()) win.show();
}

// ============ 一天一封信 ============

async function generateDailyLetter(): Promise<string | null> {
  const provider = getActiveProvider();
  if (!provider) return null;
  const cfg = getConfig();
  const data = loadPersonas();
  const opening = data.shared.letter_opening ?? '';
  const closing = data.shared.letter_closing ?? '';

  let memFacts: { predicate: string; object: string }[] = [];
  try {
    memFacts = listFacts({ status: 'active', limit: 30 }).map((f) => ({
      predicate: f.predicate,
      object: f.object
    }));
  } catch {
    /* ignore */
  }
  const prompt = buildSystemPrompt(cfg.activePersonaId, cfg.profile, memFacts);

  // 给一点点上下文 (最近 4 条 episode), 让信不显得空洞 — 严格控制 token 上限
  let recentSnippet = '';
  try {
    const eps = recentEpisodes(4);
    if (eps.length) {
      recentSnippet = '【最近的对话片段, 仅供你参考最近的状态, 不要复读】\n' +
        eps.map((e) => `${e.role}: ${e.content.slice(0, 120)}`).join('\n');
    }
  } catch {
    /* ignore */
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.combined },
    {
      role: 'user',
      content:
        '【系统注: 这是你今天主动给作家送的信. 不是回应任何具体提问. ' +
        '请以你当前人设语气, 用以下格式写一封短信:】\n' +
        `开头: ${opening || '(自由开头)'}\n` +
        `结尾: ${closing || '(自由结尾)'}\n` +
        '正文 100~180 字之间, 一段即可, 内容应该是: 一句关于今日的观察/心情/对作家近况的关切, ' +
        '可以引用最近聊过的内容或语义事实, 但不要罗列, 要自然.\n\n' +
        recentSnippet
    }
  ];
  try {
    const resp = await providerChat(provider, { messages, maxTokens: 320, temperature: 0.9 });
    return resp.text.trim();
  } catch {
    return null;
  }
}

async function tryFireDailyLetter() {
  const cfg = getConfig();
  if (!cfg.dailyLetter.enabled) return;
  const today = todayLocalDate();
  const store = getStateStore();
  if (store.get('lastLetterDate') === today) return; // 今天已发

  const now = new Date();
  const targetHour = Math.max(0, Math.min(23, cfg.dailyLetter.hour ?? 8));
  if (now.getHours() < targetHour) return; // 还没到点

  const letter = await generateDailyLetter();
  if (!letter) return;
  store.set('lastLetterDate', today);
  pushBubble(letter, 'daily-letter');
}

function armLetterTimer() {
  if (letterTimer) {
    clearInterval(letterTimer);
    letterTimer = null;
  }
  // 每 10 分钟检查一次是否到点 — 比 setTimeout(差值) 更鲁棒, 不怕系统休眠唤醒后错过
  letterTimer = setInterval(() => {
    void tryFireDailyLetter();
  }, 10 * 60 * 1000);
  // 启动后 30s 也试一次, 处理"开机时就该发了"的情况
  setTimeout(() => void tryFireDailyLetter(), 30 * 1000);
}

// ============ 话痨模式 ============

async function generateChatter(): Promise<string | null> {
  const provider = getActiveProvider();
  if (!provider) return null;
  const cfg = getConfig();

  let memFacts: { predicate: string; object: string }[] = [];
  try {
    memFacts = listFacts({ status: 'active', limit: 20 }).map((f) => ({
      predicate: f.predicate,
      object: f.object
    }));
  } catch {
    /* ignore */
  }
  const prompt = buildSystemPrompt(cfg.activePersonaId, cfg.profile, memFacts);

  // 一点点上下文 — 最近 2 条
  let recentSnippet = '';
  try {
    const eps = recentEpisodes(2);
    if (eps.length) {
      recentSnippet = '【最近交流片段】\n' + eps.map((e) => `${e.role}: ${e.content.slice(0, 80)}`).join('\n');
    }
  } catch {
    /* ignore */
  }

  const hint = cfg.safetyMode === 'danger'
    ? '若想做点什么, 仍然先口头问一句, 不要在话痨发言里直接调用工具去操作系统.'
    : '保持安静的陪伴感, 不要建议作家做事.';

  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.combined },
    {
      role: 'user',
      content:
        '【系统注: 作家好一段时间没和你说话了, 你想主动开口陪伴. 这不是回应任何具体提问. ' +
        '请用一句很短的话 (40 字以内, 不要超过 60 字) 主动搭话, 内容是当下你想到的一件小事 — ' +
        '可能是关心、轻轻的吐槽、一个突然想到的画面、一个温柔的提醒. 不要问"你在干嘛"这种空洞句. ' +
        hint + '】\n\n' + recentSnippet
    }
  ];

  try {
    const resp = await providerChat(provider, { messages, maxTokens: 120, temperature: 0.95 });
    return resp.text.trim();
  } catch {
    return null;
  }
}

function nextChatterDelayMs(): number {
  const cfg = getConfig();
  const minM = Math.max(1, cfg.chatter.minMinutes ?? 20);
  const maxM = Math.max(minM, cfg.chatter.maxMinutes ?? 240);
  const minutes = minM + Math.random() * (maxM - minM);
  return Math.round(minutes * 60 * 1000);
}

async function tryFireChatter() {
  const cfg = getConfig();
  if (!cfg.chatter.enabled) {
    armChatterTimer(); // 重新排队 (即便不发, 等用户开关回来后下次就能发)
    return;
  }
  const text = await generateChatter();
  if (text) {
    getStateStore().set('lastChatterAt', Date.now());
    pushBubble(text, 'chatter');
  }
  armChatterTimer();
}

function armChatterTimer() {
  if (chatterTimer) {
    clearTimeout(chatterTimer);
    chatterTimer = null;
  }
  const delay = nextChatterDelayMs();
  chatterTimer = setTimeout(() => {
    void tryFireChatter();
  }, delay);
}

// 用户与桌宠对话时, 顺便重置话痨计时器 — 避免刚说完话立刻又被搭话
export function noteUserInteraction() {
  getStateStore().set('lastChatterAt', Date.now());
  armChatterTimer();
}

// ============ 对外 ============

export function startProactive() {
  armLetterTimer();
  armChatterTimer();
}

export function stopProactive() {
  if (letterTimer) {
    clearInterval(letterTimer);
    letterTimer = null;
  }
  if (chatterTimer) {
    clearTimeout(chatterTimer);
    chatterTimer = null;
  }
}

// 配置变更后调用 — 重新读取间隔/开关
export function rescheduleProactive() {
  armLetterTimer();
  armChatterTimer();
}

// 调试用 — UI 里"立刻试一次"按钮
export async function triggerLetterNow(): Promise<{ ok: boolean; text?: string; reason?: string }> {
  const text = await generateDailyLetter();
  if (!text) return { ok: false, reason: '生成失败 (provider 未配置或调用错误)' };
  pushBubble(text, 'daily-letter');
  return { ok: true, text };
}

export async function triggerChatterNow(): Promise<{ ok: boolean; text?: string; reason?: string }> {
  const text = await generateChatter();
  if (!text) return { ok: false, reason: '生成失败 (provider 未配置或调用错误)' };
  pushBubble(text, 'chatter');
  return { ok: true, text };
}
