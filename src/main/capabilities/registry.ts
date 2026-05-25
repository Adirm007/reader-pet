import type { CapabilityDescriptor, CapabilityStatus, ToolDefinition } from '../../shared/types';
import { fileRead, fileWrite, fileList, fileStat } from './files';
import { shellExec } from './shell';
import { screenCapture } from './screen';
import { browserGoto, isPlaywrightInstalled } from './browser';
import { listProcesses, isMemoryRWInstalled } from './memory-rw';
import { spawn } from 'child_process';
import { getConfig } from '../config';
import {
  appendMemorySource,
  getEpisodeById,
  searchEpisodes,
  upsertFact,
  listFacts,
  setFactStatus
} from '../memory/store';

export interface ToolInvokeContext {
  sourceEpisodeId?: number;
  signal?: AbortSignal;
}

interface CapabilityTool {
  definition: ToolDefinition;
  invoke(args: any, context: ToolInvokeContext): Promise<unknown> | unknown;
}

interface CapabilityDirectAction {
  name: string;
  invoke(args: any[]): Promise<unknown> | unknown;
}

interface CapabilityAdapter {
  descriptor: CapabilityDescriptor;
  tools?: CapabilityTool[];
  getStatus?: () => Promise<CapabilityStatus> | CapabilityStatus;
  directActions?: CapabilityDirectAction[];
  stop?: () => Promise<void> | void;
}

export interface EmergencyStopResult {
  ok: boolean;
  stopped: string[];
  errors: Array<{ id: string; error: string }>;
}

function truncate(s: string | undefined, max: number): string {
  return (s ?? '').slice(0, max);
}

function dispatchClaudeCode(task: string, cwd?: string): { ok: boolean; message: string } {
  const cfg = getConfig();
  const cli = cfg.claudeCode.cliPath || 'claude';
  try {
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

const adapters: CapabilityAdapter[] = [
  {
    descriptor: {
      id: 'file_read',
      display_name: '文件读取',
      description: '读取文本文件内容',
      risk_level: 'low',
      available_in_safe: true,
      available_in_danger: true
    },
    tools: [
      {
        definition: {
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
        invoke: async (args) => ({ ok: true, content: truncate(await fileRead(args.path), 60_000) })
      },
      {
        definition: {
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
        invoke: async (args) => ({ ok: true, entries: await fileList(args.path) })
      },
      {
        definition: {
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
        invoke: async (args) => ({ ok: true, ...(await fileStat(args.path)) })
      }
    ],
    directActions: [
      { name: 'file.read', invoke: ([p]) => fileRead(p) },
      { name: 'file.list', invoke: ([p]) => fileList(p) },
      { name: 'file.stat', invoke: ([p]) => fileStat(p) }
    ]
  },
  {
    descriptor: {
      id: 'file_write',
      display_name: '文件写入',
      description: '创建或覆盖文本文件',
      risk_level: 'medium',
      available_in_safe: true,
      available_in_danger: true
    },
    tools: [
      {
        definition: {
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
        invoke: async (args) => {
          await fileWrite(args.path, args.content ?? '');
          return { ok: true, written: args.path };
        }
      }
    ],
    directActions: [{ name: 'file.write', invoke: ([p, c]) => fileWrite(p, c) }]
  },
  {
    descriptor: {
      id: 'shell_exec',
      display_name: 'Shell 命令执行',
      description: '执行 shell / PowerShell 命令',
      risk_level: 'high',
      available_in_safe: true,
      available_in_danger: true
    },
    tools: [
      {
        definition: {
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
        invoke: async (args) => {
          const r = await shellExec(args.cmd, { cwd: args.cwd, timeoutMs: args.timeoutMs });
          return {
            ok: r.exitCode === 0,
            ...r,
            stdout: truncate(r.stdout, 20_000),
            stderr: truncate(r.stderr, 8_000)
          };
        }
      }
    ],
    directActions: [{ name: 'shell.exec', invoke: ([cmd, opts]) => shellExec(cmd, opts) }]
  },
  {
    descriptor: {
      id: 'screen_capture',
      display_name: '屏幕截图',
      description: '截取屏幕内容. 在多模态模型下可直接用于视觉理解',
      risk_level: 'high',
      available_in_safe: true,
      available_in_danger: true
    },
    tools: [
      {
        definition: {
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
        invoke: async (args) => {
          const r = await screenCapture({ requestingContext: args.requesting_context });
          return {
            ok: true,
            width: r.width,
            height: r.height,
            note: '已生成截图. dataUrl 已交给应用处理, 文本模型不获取像素数据 (多模态模型才会注入).'
          };
        }
      }
    ],
    directActions: [{ name: 'screen.capture', invoke: ([opts]) => screenCapture(opts) }]
  },
  {
    descriptor: {
      id: 'browser',
      display_name: '浏览器自动化',
      description: '通过 Playwright 操控浏览器, 读取 / 改写网页元素',
      risk_level: 'critical',
      available_in_safe: false,
      available_in_danger: true,
      requires_extra_enable: true,
      enable_flag: 'playwrightEnabled'
    },
    tools: [
      {
        definition: {
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
        invoke: async (args) => {
          const r = await browserGoto(args.url);
          return { ok: r.ok, url: r.url, title: r.title, text: truncate(r.text, 8000) };
        }
      }
    ],
    getStatus: async () => {
      const installed = await isPlaywrightInstalled();
      return installed
        ? { id: 'browser', status: 'available', message: '已安装' }
        : { id: 'browser', status: 'not_installed', message: '未安装 (运行时调用会报错)' };
    },
    directActions: [{ name: 'browser.goto', invoke: ([url]) => browserGoto(url) }]
  },
  {
    descriptor: {
      id: 'memory_rw',
      display_name: '进程内存读写',
      description: 'Cheat Engine 风格的进程内存读写. 仅限本机自用',
      risk_level: 'critical',
      available_in_safe: false,
      available_in_danger: true,
      requires_extra_enable: true,
      enable_flag: 'memoryRWEnabled'
    },
    tools: [
      {
        definition: {
          type: 'function',
          function: {
            name: 'list_game_processes',
            description: '列出当前进程 (供选择内存读写目标). 仅限危险模式 + 已启用 memory_rw.',
            parameters: { type: 'object', properties: {} }
          }
        },
        invoke: async () => ({ ok: true, processes: (await listProcesses()).slice(0, 200) })
      }
    ],
    getStatus: async () => {
      const installed = await isMemoryRWInstalled();
      return installed
        ? { id: 'memory_rw', status: 'available', message: '已安装' }
        : { id: 'memory_rw', status: 'not_installed', message: '未安装' };
    },
    directActions: [{ name: 'memory.listProcesses', invoke: () => listProcesses() }]
  },
  {
    descriptor: {
      id: 'claude_code_task',
      display_name: 'Claude Code 工程任务',
      description: '把工程化任务派给 Claude Code CLI 后台执行',
      risk_level: 'high',
      available_in_safe: true,
      available_in_danger: true
    },
    tools: [
      {
        definition: {
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
        invoke: (args) => dispatchClaudeCode(args.task, args.cwd)
      }
    ]
  },
  {
    descriptor: {
      id: 'conversation_memory',
      display_name: '对话记忆',
      description: '检索、记录和撤回对话中的稳定事实',
      risk_level: 'medium',
      available_in_safe: true,
      available_in_danger: true
    },
    tools: [
      {
        definition: {
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
        invoke: (args) => ({
          ok: true,
          hits: searchEpisodes(args.query, args.limit ?? 10).map((r) => ({
            id: r.id,
            ts: r.ts,
            role: r.role,
            persona: r.persona_id,
            content: truncate(r.content, 800)
          }))
        })
      },
      {
        definition: {
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
        invoke: (args, context) => {
          const r = upsertFact({
            predicate: args.predicate,
            subject: args.subject ?? 'user',
            object: args.object,
            confidence: args.confidence,
            source_episode_id: context.sourceEpisodeId
          });
          if (context.sourceEpisodeId) {
            const sourceEpisode = getEpisodeById(context.sourceEpisodeId);
            appendMemorySource({
              memory_type: 'fact',
              memory_id: r.id,
              source_type: 'episode',
              source_id: context.sourceEpisodeId,
              excerpt: (sourceEpisode?.content ?? String(args.object ?? '')).slice(0, 800)
            });
          }
          return { ok: true, ...r };
        }
      },
      {
        definition: {
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
        invoke: (args) => {
          setFactStatus(args.id, 'retracted');
          return { ok: true };
        }
      },
      {
        definition: {
          type: 'function',
          function: {
            name: 'list_active_facts',
            description: '列出当前所有 active 事实 (供对话中需要时参考). 默认上限 50.',
            parameters: {
              type: 'object',
              properties: { limit: { type: 'number' } }
            }
          }
        },
        invoke: (args) => ({
          ok: true,
          facts: listFacts({ status: 'active', limit: args.limit ?? 50 }).map((f) => ({
            id: f.id,
            predicate: f.predicate,
            subject: f.subject,
            object: f.object,
            confidence: f.confidence
          }))
        })
      }
    ]
  }
];

const toolMap = new Map<string, CapabilityTool>();
const directActionMap = new Map<string, CapabilityDirectAction>();

for (const adapter of adapters) {
  for (const tool of adapter.tools ?? []) {
    const name = tool.definition.function.name;
    if (toolMap.has(name)) throw new Error(`Duplicate capability tool name: ${name}`);
    toolMap.set(name, tool);
  }
  for (const action of adapter.directActions ?? []) {
    if (directActionMap.has(action.name)) throw new Error(`Duplicate capability direct action: ${action.name}`);
    directActionMap.set(action.name, action);
  }
}

export function listCapabilityDescriptors(): CapabilityDescriptor[] {
  return adapters.map((a) => a.descriptor);
}

export async function listCapabilityStatuses(): Promise<CapabilityStatus[]> {
  return Promise.all(
    adapters.map(async (a) => {
      if (!a.getStatus) return { id: a.descriptor.id, status: 'available' as const };
      try {
        return await a.getStatus();
      } catch (e: any) {
        return { id: a.descriptor.id, status: 'unavailable' as const, message: e?.message ?? String(e) };
      }
    })
  );
}

export async function getCapabilityStatus(id: string): Promise<CapabilityStatus | null> {
  return (await listCapabilityStatuses()).find((s) => s.id === id) ?? null;
}

export function listToolDefinitions(): ToolDefinition[] {
  return Array.from(toolMap.values()).map((t) => t.definition);
}

export async function invokeTool(
  name: string,
  argsJson: string,
  context: ToolInvokeContext = {}
): Promise<string> {
  let args: any = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch (e) {
    return JSON.stringify({ error: `参数 JSON 解析失败: ${e}` });
  }

  const tool = toolMap.get(name);
  if (!tool) return JSON.stringify({ error: `unknown tool: ${name}` });

  try {
    return JSON.stringify(await tool.invoke(args, context));
  } catch (e: any) {
    return JSON.stringify({ error: e?.message ?? String(e) });
  }
}

export async function invokeDirectAction(name: string, args: any[]): Promise<unknown> {
  const action = directActionMap.get(name);
  if (!action) throw new Error(`unknown capability action: ${name}`);
  return action.invoke(args);
}

export async function emergencyStop(): Promise<EmergencyStopResult> {
  const stopped: string[] = [];
  const errors: EmergencyStopResult['errors'] = [];
  for (const adapter of adapters) {
    if (!adapter.stop) continue;
    try {
      await adapter.stop();
      stopped.push(adapter.descriptor.id);
    } catch (e: any) {
      errors.push({ id: adapter.descriptor.id, error: e?.message ?? String(e) });
    }
  }
  return { ok: errors.length === 0, stopped, errors };
}
