// 工具定义 + 调度
// 给 LLM 用的 OpenAI function-calling schema, 同时附带服务端调度入口
import type { ToolDefinition } from '../shared/types';
import { fileRead, fileWrite, fileList, fileStat } from './capabilities/files';
import { shellExec } from './capabilities/shell';
import { screenCapture } from './capabilities/screen';
import { browserGoto } from './capabilities/browser';
import { listProcesses } from './capabilities/memory-rw';
import { spawn } from 'child_process';
import { getConfig } from './config';
import {
  searchEpisodes,
  upsertFact,
  listFacts,
  setFactStatus
} from './memory/store';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取文本文件全文. 安全模式下仅允许读取白名单目录.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '绝对或相对路径' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '创建或覆盖文本文件. 安全模式下仅允许写入白名单目录.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '列出目录下条目名 (安全模式受白名单约束).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'stat_path',
      description: '查询路径元信息 (size/isDir/mtime).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exec_shell',
      description:
        '执行 shell 命令 (Windows 走 PowerShell). 安全模式下仅允许白名单首词. 返回 stdout/stderr/exitCode.',
      parameters: {
        type: 'object',
        properties: {
          cmd: { type: 'string' },
          cwd: { type: 'string' },
          timeoutMs: { type: 'number' }
        },
        required: ['cmd']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'capture_screen',
      description: '截取主屏幕缩略图 (1280x800), 返回 dataUrl. 安全模式下会向用户弹窗确认.',
      parameters: {
        type: 'object',
        properties: {
          requesting_context: {
            type: 'string',
            description: '简要说明此次截屏意图, 用于向用户解释'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_goto',
      description: '用 Playwright 访问 URL 并返回标题+正文文本 (前 8000 字). 仅限危险模式 + 已启用.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_game_processes',
      description: '列出当前进程 (供选择内存读写目标). 仅限危险模式 + 已启用 memory_rw.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'dispatch_claude_code_task',
      description:
        '把一项工程化任务派给 Claude Code CLI 后台执行. 完成后会通过 Stop hook 自动通知夜梦. 此调用立即返回, 不阻塞.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: '给 Claude Code 的自然语言任务描述' },
          cwd: { type: 'string', description: '工作目录, 默认是当前激活项目目录' }
        },
        required: ['task']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recall_episodes',
      description:
        '在过往对话历史中按关键词检索 (FTS5). 仅当作家先生/作家小姐主动让你"想想看 / 你之前说过吗"时再用, 平时不要动.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', description: '默认 10' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember_fact',
      description:
        '把一条关于作家的稳定事实记下来 (例如 偏好的称呼 / 在写的作品 / 不喜欢的措辞). 同 predicate+subject 已有事实会被自动 supersede.',
      parameters: {
        type: 'object',
        properties: {
          predicate: { type: 'string', description: '事实键, 例如 favorite_color / current_project' },
          subject: { type: 'string', description: '默认 "user"' },
          object: { type: 'string', description: '事实值' },
          confidence: { type: 'number' }
        },
        required: ['predicate', 'object']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'forget_fact',
      description: '把某条事实标记为 retracted (软删).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_active_facts',
      description: '列出当前所有 active 事实 (供对话中需要时参考). 默认上限 50.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number' } }
      }
    }
  }
];

function dispatchClaudeCode(task: string, cwd?: string): { ok: boolean; message: string } {
  const cfg = getConfig();
  const cli = cfg.claudeCode.cliPath || 'claude';
  try {
    // 后台启动, 不等待
    const child = spawn(cli, ['-p', task], {
      cwd: cwd || process.cwd(),
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32'
    });
    child.on('error', () => {});
    child.unref();
    return { ok: true, message: `已派发给 Claude Code (cli=${cli}, cwd=${cwd ?? process.cwd()})` };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? String(e) };
  }
}

export async function callTool(name: string, argsJson: string): Promise<string> {
  let args: any = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch (e) {
    return JSON.stringify({ error: `参数 JSON 解析失败: ${e}` });
  }
  try {
    switch (name) {
      case 'read_file': {
        const txt = await fileRead(args.path);
        return JSON.stringify({ ok: true, content: txt.slice(0, 60_000) });
      }
      case 'write_file': {
        await fileWrite(args.path, args.content ?? '');
        return JSON.stringify({ ok: true, written: args.path });
      }
      case 'list_dir': {
        const list = await fileList(args.path);
        return JSON.stringify({ ok: true, entries: list });
      }
      case 'stat_path': {
        const s = await fileStat(args.path);
        return JSON.stringify({ ok: true, ...s });
      }
      case 'exec_shell': {
        const r = await shellExec(args.cmd, { cwd: args.cwd, timeoutMs: args.timeoutMs });
        return JSON.stringify({ ok: r.exitCode === 0, ...r, stdout: r.stdout.slice(0, 20_000), stderr: r.stderr.slice(0, 8_000) });
      }
      case 'capture_screen': {
        const r = await screenCapture({ requestingContext: args.requesting_context });
        // dataUrl 太长, 模型用不上 base64; 只回元信息 + 一个标记
        return JSON.stringify({
          ok: true,
          width: r.width,
          height: r.height,
          note: '已生成截图. dataUrl 已交给应用处理, 文本模型不获取像素数据 (多模态模型才会注入).'
        });
      }
      case 'browser_goto': {
        const r = await browserGoto(args.url);
        return JSON.stringify({ ok: r.ok, url: r.url, title: r.title, text: r.text.slice(0, 8000) });
      }
      case 'list_game_processes': {
        const ps = await listProcesses();
        return JSON.stringify({ ok: true, processes: ps.slice(0, 200) });
      }
      case 'dispatch_claude_code_task': {
        return JSON.stringify(dispatchClaudeCode(args.task, args.cwd));
      }
      case 'recall_episodes': {
        const rows = searchEpisodes(args.query, args.limit ?? 10);
        return JSON.stringify({
          ok: true,
          hits: rows.map((r) => ({
            id: r.id,
            ts: r.ts,
            role: r.role,
            persona: r.persona_id,
            content: r.content.slice(0, 800)
          }))
        });
      }
      case 'remember_fact': {
        const r = upsertFact({
          predicate: args.predicate,
          subject: args.subject ?? 'user',
          object: args.object,
          confidence: args.confidence
        });
        return JSON.stringify({ ok: true, ...r });
      }
      case 'forget_fact': {
        setFactStatus(args.id, 'retracted');
        return JSON.stringify({ ok: true });
      }
      case 'list_active_facts': {
        const facts = listFacts({ status: 'active', limit: args.limit ?? 50 });
        return JSON.stringify({
          ok: true,
          facts: facts.map((f) => ({
            id: f.id,
            predicate: f.predicate,
            subject: f.subject,
            object: f.object,
            confidence: f.confidence
          }))
        });
      }
      default:
        return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  } catch (e: any) {
    return JSON.stringify({ error: e?.message ?? String(e) });
  }
}
