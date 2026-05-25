import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { CapabilityStatus } from '../../shared/types';
import { getConfig } from '../config';
import { checkMaa } from '../permissions';

let child: ChildProcessWithoutNullStreams | null = null;

export function getMaaStatus(): CapabilityStatus {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe') return { id: 'maa', status: 'blocked', message: '仅危险模式可用' };
  if (!cfg.capabilities.maaEnabled) return { id: 'maa', status: 'disabled', message: '未启用 MAA / MaaFramework' };
  if (!cfg.automation.maaCommand.trim()) return { id: 'maa', status: 'disabled', message: '未配置 MAA 命令' };
  return { id: 'maa', status: 'available', message: '已配置命令' };
}

export async function runMaaTask(args: { task: string; profile?: string; extraArgs?: string[]; timeoutMs?: number }) {
  const decision = checkMaa();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  if (child) throw new Error('已有 MAA 任务在运行');
  const cfg = getConfig();
  if (!cfg.automation.maaCommand.trim()) throw new Error('未配置 MAA 命令');
  const extraArgs = Array.isArray(args.extraArgs) ? args.extraArgs.slice(0, 20).map(String) : [];
  const argv = [String(args.task), ...(args.profile ? ['--profile', String(args.profile)] : []), ...extraArgs];
  const timeoutMs = Math.max(1000, Math.min(args.timeoutMs ?? 120_000, 600_000));

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child?.kill();
      child = null;
      reject(new Error('MAA 任务超时并已停止'));
    }, timeoutMs);

    child = spawn(cfg.automation.maaCommand, argv, {
      cwd: cfg.automation.maaWorkingDir || undefined,
      windowsHide: true,
      shell: false
    });
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk.toString('utf8')).slice(-20_000);
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
      resolve({ ok: code === 0, code, signal, stdout, stderr });
    });
  });
}

export async function stopMaa(): Promise<void> {
  if (child && !child.killed) child.kill();
  child = null;
}
