// Claude Code Stop hook 安装/卸载器
// 思路: 改写用户 ~/.claude/settings.json, 在 hooks.Stop 注册 curl 推送到 127.0.0.1:7711/hook/stop
// 兼容 Windows: 用 PowerShell 调用 Invoke-RestMethod (curl 在老 Windows 是 Invoke-WebRequest 别名, 行为不一致)
import { promises as fs } from 'fs';
import { homedir, platform } from 'os';
import { join, dirname } from 'path';

const CLAUDE_DIR = join(homedir(), '.claude');
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');
const MARKER = 'reader-pet/stop-hook';

function buildHookCommand(port: number): string {
  if (platform() === 'win32') {
    // PowerShell: 读 stdin (Claude Code 会把 hook payload JSON 通过 stdin 传入)
    return (
      `powershell -NoProfile -NonInteractive -Command "` +
      `$payload = [Console]::In.ReadToEnd(); ` +
      `try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:${port}/hook/stop' ` +
      `-Body $payload -ContentType 'application/json' -TimeoutSec 5 | Out-Null } catch { }"`
    );
  }
  // *nix: curl 一行
  return `curl -sS -X POST 'http://127.0.0.1:${port}/hook/stop' -H 'Content-Type: application/json' --data-binary @- || true`;
}

interface ClaudeSettings {
  hooks?: Record<string, any[]>;
  [k: string]: any;
}

async function readSettings(): Promise<ClaudeSettings> {
  try {
    const txt = await fs.readFile(SETTINGS_PATH, 'utf-8');
    return JSON.parse(txt);
  } catch (e: any) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

async function writeSettings(s: ClaudeSettings) {
  await fs.mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf-8');
}

export async function installStopHook(port: number): Promise<{ ok: boolean; message: string }> {
  const s = await readSettings();
  s.hooks = s.hooks ?? {};
  const stopList: any[] = Array.isArray(s.hooks.Stop) ? s.hooks.Stop : [];
  // 移除我们之前装过的 (按 marker)
  const filtered = stopList.filter((entry) => {
    const hooksArr: any[] = Array.isArray(entry?.hooks) ? entry.hooks : [];
    return !hooksArr.some((h) => typeof h?.command === 'string' && h.command.includes(MARKER));
  });
  filtered.push({
    matcher: '',
    hooks: [
      {
        type: 'command',
        // 把 marker 注入 command, 之后能识别我们装的条目
        command: `${buildHookCommand(port)}  # ${MARKER}`,
        timeout: 10
      }
    ]
  });
  s.hooks.Stop = filtered;
  await writeSettings(s);
  return { ok: true, message: `已写入 ${SETTINGS_PATH} (port=${port})` };
}

export async function uninstallStopHook(): Promise<{ ok: boolean; message: string }> {
  const s = await readSettings();
  if (!s.hooks?.Stop) return { ok: true, message: '没有 Stop hook 需要卸载' };
  const before = s.hooks.Stop.length;
  s.hooks.Stop = s.hooks.Stop.filter((entry: any) => {
    const hooksArr: any[] = Array.isArray(entry?.hooks) ? entry.hooks : [];
    return !hooksArr.some((h) => typeof h?.command === 'string' && h.command.includes(MARKER));
  });
  if (s.hooks.Stop.length === 0) delete s.hooks.Stop;
  await writeSettings(s);
  return { ok: true, message: `已移除 ${before - (s.hooks.Stop?.length ?? 0)} 个条目` };
}

export async function isStopHookInstalled(): Promise<boolean> {
  const s = await readSettings();
  if (!Array.isArray(s.hooks?.Stop)) return false;
  return s.hooks!.Stop.some((entry: any) => {
    const hooksArr: any[] = Array.isArray(entry?.hooks) ? entry.hooks : [];
    return hooksArr.some((h) => typeof h?.command === 'string' && h.command.includes(MARKER));
  });
}
