import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { CapabilityStatus } from '../../shared/types';
import { getConfig } from '../config';
import { checkCliAnything } from '../permissions';

let child: ChildProcessWithoutNullStreams | null = null;

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
  const payload = JSON.stringify({ input: args.input ?? {}, schema: args.schema ?? null });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child?.kill();
      child = null;
      reject(new Error('CLI-Anything 任务超时并已停止'));
    }, timeoutMs);

    child = spawn(cfg.automation.cliAnythingCommand, [], {
      cwd: cfg.automation.cliAnythingWorkingDir || undefined,
      windowsHide: true,
      shell: false
    });
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk.toString('utf8')).slice(-40_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      child = null;
      reject(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      child = null;
      let json: unknown = null;
      try {
        json = stdout.trim() ? JSON.parse(stdout) : null;
      } catch {}
      resolve({ ok: code === 0, code, signal, json, rawStdout: json ? undefined : stdout, stderr });
    });
    child.stdin.end(payload);
  });
}

export async function stopCliAnything(): Promise<void> {
  if (child && !child.killed) child.kill();
  child = null;
}
