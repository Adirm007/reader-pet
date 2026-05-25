// 内心独白日志 — 默认对用户与 LLM 双隐藏, 但供用户随时调出查看
//
// 存储:
//   - 内存 ring buffer (上限 200 条), 用于 IPC 即时返回
//   - 落地 jsonl 到 userData/inner-monologue.jsonl, 每行一条独白记录
//
// 不入 SQLite — 独白属于"调试/观察"层, 跟语义事实和 episode 不是一个用途, 单文件更方便
// 用户直接下载/打开查看, 也方便配对不同模型做对比
import { app } from 'electron';
import { join } from 'path';
import { appendFileSync, readFileSync, existsSync, unlinkSync } from 'fs';

export interface MonologueEntry {
  ts: number;
  source: 'chat' | 'chatter' | 'letter' | 'task-report';
  persona: string;
  provider: string;       // provider.id, 方便对比不同模型的思考长度/风格
  model: string;          // provider.model
  trigger?: string;       // 触发这次思考的输入 (用户问的话 / tool result 摘要 / 系统注)
  monologue: string;      // 独白原文
  dialog: string;         // 最终对外说的话 (空字符串表示这次只调了工具没说话)
  outputTokens?: number;  // 整段输出的 token 数 (含独白), 便于成本观察
}

const RING_LIMIT = 200;
const ring: MonologueEntry[] = [];

let logPath: string | null = null;
function getLogPath(): string {
  if (logPath) return logPath;
  logPath = join(app.getPath('userData'), 'inner-monologue.jsonl');
  return logPath;
}

export function recordMonologue(entry: MonologueEntry): void {
  // 没有独白就别记 — 比如 provider 不支持 prefill 时模型直接输出对白, 无独白可观察
  if (!entry.monologue) return;
  ring.push(entry);
  while (ring.length > RING_LIMIT) ring.shift();
  try {
    appendFileSync(getLogPath(), JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // 落地失败不阻断主流程; 内存里还有
  }
}

// 取最近 N 条 — 优先从内存; 不够再回填磁盘 (用户重启后内存空, 但磁盘有)
export function listMonologues(limit: number = 50): MonologueEntry[] {
  if (ring.length >= limit) return ring.slice(-limit);
  // 内存不足, 从磁盘补
  try {
    if (!existsSync(getLogPath())) return ring.slice();
    const raw = readFileSync(getLogPath(), 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    const fromDisk: MonologueEntry[] = [];
    // 从尾部往前读到够
    for (let i = lines.length - 1; i >= 0 && fromDisk.length < limit; i--) {
      try {
        fromDisk.unshift(JSON.parse(lines[i]));
      } catch {
        /* 单行损坏忽略 */
      }
    }
    return fromDisk;
  } catch {
    return ring.slice();
  }
}

export function clearMonologues(): void {
  ring.length = 0;
  try {
    if (existsSync(getLogPath())) unlinkSync(getLogPath());
  } catch {
    /* ignore */
  }
}

export function getLogFilePath(): string {
  return getLogPath();
}
