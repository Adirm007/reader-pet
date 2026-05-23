// Shell 能力 — 经过 permissions gate
import { exec } from 'child_process';
import { promisify } from 'util';
import { checkShell } from '../permissions';

const execAsync = promisify(exec);

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function shellExec(cmd: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<ShellResult> {
  const decision = checkShell(cmd);
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  try {
    const r = await execAsync(cmd, {
      cwd: opts?.cwd,
      timeout: opts?.timeoutMs ?? 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
    });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(e),
      exitCode: typeof e.code === 'number' ? e.code : 1
    };
  }
}
