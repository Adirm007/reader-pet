// Claude Code 桥接 — 监听本地 HTTP, 接 Stop hook 推送
// 设计目标:
//   1. 仅绑定 127.0.0.1, 不暴露公网
//   2. 极小依赖 (Node 内建 http)
//   3. 收到 hook 后, 解析 transcript, 用当前人设语气复述完成情况
//   4. 把"夜梦汇报"推到桌宠气泡 (后续再接 TTS)
import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { promises as fs } from 'fs';
import { BrowserWindow } from 'electron';
import { getConfig, getActiveProvider } from './config';
import { buildSystemPrompt, INNER_MONOLOGUE_PREFILL, parseInnerMonologue } from './personas-loader';
import { chat as providerChat } from './providers';
import { appendTask } from './memory/store';
import { recordMonologue } from './inner-monologue-log';
import type { TaskReport, ChatMessage } from '../shared/types';

let server: Server | null = null;
let getPetWindow: (() => BrowserWindow | null) = () => null;

export function setPetWindowGetter(fn: () => BrowserWindow | null) {
  getPetWindow = fn;
}

interface StopHookPayload {
  session_id?: string;
  transcript_path?: string;
  hook_event_name?: string;
  cwd?: string;
  stop_hook_active?: boolean;
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// 从 transcript jsonl 末尾抓出最近的 assistant 文本作为简报输入
async function extractRecentAssistantText(transcriptPath: string): Promise<string> {
  try {
    const txt = await fs.readFile(transcriptPath, 'utf-8');
    const lines = txt.split(/\r?\n/).filter(Boolean);
    // 倒序找最近的 assistant 文本块
    const collected: string[] = [];
    for (let i = lines.length - 1; i >= 0 && collected.length < 5; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        // Claude Code transcript 形如 { type: 'assistant', message: { content: [{type:'text', text:'...'}] } }
        if (obj.type === 'assistant' && obj.message?.content) {
          for (const c of obj.message.content) {
            if (c.type === 'text' && c.text) collected.unshift(c.text);
          }
        }
      } catch {
        // ignore broken line
      }
    }
    return collected.join('\n').slice(-4000);
  } catch (e: any) {
    return `(无法读取 transcript: ${e?.message ?? e})`;
  }
}

async function generatePersonaSummary(rawAssistantText: string): Promise<string> {
  const cfg = getConfig();
  const provider = getActiveProvider();
  if (!provider) {
    return `(夜梦没法用人设语气汇报: 还没设置 provider)\n${rawAssistantText.slice(0, 500)}`;
  }
  const prompt = buildSystemPrompt(cfg.activePersonaId, cfg.profile);
  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.combined },
    {
      role: 'user',
      content:
        '【系统注: 这是 Claude Code 刚完成一个任务时的最终输出. 请你以当前人设语气, ' +
        '在 80 字内向作家先生/作家小姐复述任务完成情况和关键结果, 不要原样转述, 不要列举步骤, ' +
        '只说重点. 】\n\n' +
        rawAssistantText
    }
  ];
  try {
    const resp = await providerChat(provider, {
      messages,
      maxTokens: 30000,          // 不限制思考长度
      temperature: 0.85,
      prefill: INNER_MONOLOGUE_PREFILL
    });
    const { monologue, dialog } = parseInnerMonologue(resp.text);
    recordMonologue({
      ts: Date.now(),
      source: 'task-report',
      persona: cfg.activePersonaId,
      provider: provider.id,
      model: provider.model,
      trigger: 'Claude Code 任务完成: ' + rawAssistantText.slice(0, 200),
      monologue,
      dialog,
      outputTokens: resp.usage?.outputTokens
    });
    return dialog;
  } catch (e: any) {
    return `(汇报生成失败: ${e?.message ?? e})`;
  }
}

function pushToPet(text: string, kind: 'task-report' | 'info' = 'task-report') {
  const win = getPetWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('pet:bubble', { text, kind, ts: Date.now() });
  if (!win.isVisible()) win.show();
}

async function handleStopHook(payload: StopHookPayload) {
  const cfg = getConfig();
  const report: TaskReport = {
    receivedAt: Date.now(),
    session_id: payload.session_id,
    transcript_path: payload.transcript_path,
    raw: payload
  };
  let body = '';
  if (payload.transcript_path) {
    body = await extractRecentAssistantText(payload.transcript_path);
  }
  if (cfg.claudeCode.reportInPersonaVoice && body) {
    report.summary = await generatePersonaSummary(body);
  } else {
    report.summary = body.slice(0, 400) || '(任务完成, 但 transcript 为空)';
  }
  pushToPet(report.summary ?? '(任务完成)');

  // 持久化到 Layer 5 task log
  try {
    appendTask({
      ts: report.receivedAt,
      session_id: report.session_id,
      transcript_path: report.transcript_path,
      summary: report.summary,
      raw_json: JSON.stringify(report.raw)
    });
  } catch {
    /* ignore */
  }
  return report;
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  // 严格只接 127.0.0.1
  const remote = req.socket.remoteAddress ?? '';
  if (!remote.includes('127.0.0.1') && remote !== '::1' && !remote.endsWith(':127.0.0.1')) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, service: 'reader-pet/claude-code-bridge' }));
    return;
  }
  if (req.method === 'POST' && req.url === '/hook/stop') {
    try {
      const bodyText = await readBody(req);
      const payload: StopHookPayload = bodyText ? JSON.parse(bodyText) : {};
      const report = await handleStopHook(payload);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, received: true, summary: report.summary }));
    } catch (e: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: e?.message ?? String(e) }));
    }
    return;
  }
  res.statusCode = 404;
  res.end('not found');
}

export async function startBridge(): Promise<{ ok: boolean; port?: number; reason?: string }> {
  const cfg = getConfig();
  if (!cfg.claudeCode.hookServerEnabled) {
    return { ok: false, reason: '未启用 Claude Code hook 服务' };
  }
  if (server) return { ok: true, port: cfg.claudeCode.hookServerPort };
  return new Promise((resolveP) => {
    const s = createServer(handler);
    s.once('error', (err) => {
      resolveP({ ok: false, reason: String(err) });
    });
    s.listen(cfg.claudeCode.hookServerPort, '127.0.0.1', () => {
      server = s;
      resolveP({ ok: true, port: cfg.claudeCode.hookServerPort });
    });
  });
}

export function stopBridge() {
  if (server) {
    server.close();
    server = null;
  }
}

export function isBridgeRunning(): boolean {
  return server !== null;
}
