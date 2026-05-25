import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { CapabilityRuntimeStatus, CapabilityStatus } from '../../shared/types';
import { getConfig } from '../config';
import { checkCliAnything } from '../permissions';

let child: ChildProcessWithoutNullStreams | null = null;
let startedAt: number | undefined;
let lastError: string | undefined;

function protocolError(message: string, code: number | null, signal: NodeJS.Signals | null, rawStdout: string, stderr: string) {
  lastError = message;
  return { ok: false, code, signal, json: null, rawStdout, stderr, error: message };
}

function parseProtocolResult(stdout: string, code: number | null, signal: NodeJS.Signals | null, stderr: string) {
  const trimmed = stdout.trim();
  if (!trimmed) return protocolError('CLI-Anything 协议错误: stdout 为空', code, signal, stdout, stderr);

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (e: any) {
    return protocolError(`CLI-Anything 协议错误: stdout 不是有效 JSON (${e?.message ?? String(e)})`, code, signal, stdout, stderr);
  }

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return protocolError('CLI-Anything 协议错误: stdout JSON 必须是 object', code, signal, stdout, stderr);
  }

  if (code !== 0) lastError = `CLI-Anything 任务退出 code=${code} signal=${signal}`;
  return { ok: code === 0, code, signal, json, stderr };
}

export function getCliAnythingStatus(): CapabilityStatus {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe') return { id: 'cli_anything', status: 'blocked', message: '仅危险模式可用' };
  if (!cfg.capabilities.cliAnythingEnabled) return { id: 'cli_anything', status: 'disabled', message: '未启用 CLI-Anything' };
  if (!cfg.automation.cliAnythingCommand.trim()) return { id: 'cli_anything', status: 'disabled', message: '未配置 CLI-Anything 命令' };
  return { id: 'cli_anything', status: 'available', message: '已配置命令' };
}

export async function runCliAnything(args: { input: Record<string, unknown>; schema?: unknown; timeoutMs?: number }) {
  const decision = checkCliAnything();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  if (child) throw new Error('已有 CLI-Anything 任务在运行');
  const cfg = getConfig();
  if (!cfg.automation.cliAnythingCommand.trim()) throw new Error('未配置 CLI-Anything 命令');
  const timeoutMs = Math.max(1000, Math.min(args.timeoutMs ?? 60_000, 300_000));
  const payload = JSON.stringify({ version: 1, input: args.input ?? {}, schema: args.schema ?? null });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      child = null;
      startedAt = undefined;
    };
    const settleResolve = (value: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const timer = setTimeout(() => {
      lastError = 'CLI-Anything 任务超时并已停止';
      child?.kill();
      settleReject(new Error('CLI-Anything 任务超时并已停止'));
    }, timeoutMs);

    child = spawn(cfg.automation.cliAnythingCommand, cfg.automation.cliAnythingArgs ?? [], {
      cwd: cfg.automation.cliAnythingWorkingDir || undefined,
      windowsHide: true,
      shell: false
    });
    startedAt = Date.now();
    lastError = undefined;
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk.toString('utf8')).slice(-40_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8000);
    });
    child.on('error', (err) => {
      lastError = err.message;
      settleReject(err);
    });
    child.on('exit', (code, signal) => {
      settleResolve(parseProtocolResult(stdout, code, signal, stderr));
    });
    child.stdin.end(payload);
  });
}

export function getCliAnythingRuntimeStatus(): CapabilityRuntimeStatus {
  return {
    id: 'cli_anything',
    running: !!child && !child.killed,
    detail: child && !child.killed ? 'CLI-Anything task' : undefined,
    pid: child?.pid,
    startedAt,
    lastError
  };
}

export async function stopCliAnything(): Promise<void> {
  if (child && !child.killed) child.kill();
  child = null;
  startedAt = undefined;
}
