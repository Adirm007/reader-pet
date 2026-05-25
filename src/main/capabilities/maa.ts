import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { existsSync } from 'fs';
import type { CapabilityRuntimeStatus, CapabilityStatus } from '../../shared/types';
import { getConfig } from '../config';
import { checkMaa } from '../permissions';

let child: ChildProcessWithoutNullStreams | null = null;
let startedAt: number | undefined;
let lastError: string | undefined;
let currentDetail: string | undefined;

export function getMaaStatus(): CapabilityStatus {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe') return { id: 'maa', status: 'blocked', message: '仅危险模式可用' };
  if (!cfg.capabilities.maaEnabled) return { id: 'maa', status: 'disabled', message: '未启用 MAA / MaaFramework' };
  if (!cfg.automation.maaCommand.trim()) return { id: 'maa', status: 'disabled', message: '未配置 MAA 命令' };
  return { id: 'maa', status: 'available', message: '已配置命令' };
}

export async function runMaaTask(args: { task?: string; profile?: string; extraArgs?: string[]; timeoutMs?: number }) {
  const decision = checkMaa();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  if (child) throw new Error('已有 MAA 任务在运行');
  const cfg = getConfig();
  const command = cfg.automation.maaCommand.trim();
  if (!command) throw new Error('未配置 MAA 命令');
  if (cfg.automation.maaWorkingDir && !existsSync(cfg.automation.maaWorkingDir)) throw new Error('MAA working dir 不存在');
  if (cfg.automation.maaAssetsDir && !existsSync(cfg.automation.maaAssetsDir)) throw new Error('MAA assets dir 不存在');
  if (cfg.automation.maaTaskConfigPath && !existsSync(cfg.automation.maaTaskConfigPath)) throw new Error('MAA task config path 不存在');

  const task = String(args.task || cfg.automation.maaDefaultTask || '').trim();
  if (!task) throw new Error('未指定 MAA task，也未配置默认 task');
  const configuredExtraArgs = Array.isArray(cfg.automation.maaExtraArgs) ? cfg.automation.maaExtraArgs : [];
  const runtimeExtraArgs = Array.isArray(args.extraArgs) ? args.extraArgs : [];
  const extraArgs = [...configuredExtraArgs, ...runtimeExtraArgs].slice(0, 40).map(String).filter(Boolean);
  const argv = [
    task,
    ...(args.profile ? ['--profile', String(args.profile)] : []),
    ...(cfg.automation.maaAssetsDir ? ['--assets', cfg.automation.maaAssetsDir] : []),
    ...(cfg.automation.maaTaskConfigPath ? ['--config', cfg.automation.maaTaskConfigPath] : []),
    ...extraArgs
  ];
  const commandPreview = [command, ...argv].map((part) => (part.includes(' ') ? `"${part}"` : part)).join(' ');
  const timeoutMs = Math.max(1000, Math.min(args.timeoutMs ?? 120_000, 600_000));

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child?.kill();
      child = null;
      startedAt = undefined;
      currentDetail = undefined;
      lastError = 'MAA 任务超时并已停止';
      reject(new Error('MAA 任务超时并已停止'));
    }, timeoutMs);

    child = spawn(command, argv, {
      cwd: cfg.automation.maaWorkingDir || undefined,
      windowsHide: true,
      shell: false
    });
    startedAt = Date.now();
    currentDetail = `${task} · ${commandPreview}`;
    lastError = undefined;
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk.toString('utf8')).slice(-20_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      child = null;
      startedAt = undefined;
      currentDetail = undefined;
      lastError = err.message;
      reject(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      child = null;
      startedAt = undefined;
      currentDetail = undefined;
      if (code !== 0) lastError = `MAA 任务退出 code=${code} signal=${signal}`;
      resolve({ ok: code === 0, code, signal, commandPreview, stdout, stderr });
    });
  });
}

export function getMaaRuntimeStatus(): CapabilityRuntimeStatus {
  return {
    id: 'maa',
    running: !!child && !child.killed,
    detail: child && !child.killed ? currentDetail : undefined,
    pid: child?.pid,
    startedAt,
    lastError
  };
}

export async function stopMaa(): Promise<void> {
  if (child && !child.killed) child.kill();
  child = null;
  startedAt = undefined;
  currentDetail = undefined;
}
