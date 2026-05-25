import { spawn } from 'child_process';
import type { CapabilityRuntimeStatus, CapabilityStatus, DesktopAutomationAction, DesktopAutomationQueueRequest } from '../../shared/types';
import { getConfig } from '../config';
import { checkDesktopAutomation } from '../permissions';

let abortRequested = false;
let running = false;
let startedAt: number | undefined;
let currentIndex: number | undefined;
let totalActions = 0;
let completedActions = 0;
let currentAction: DesktopAutomationAction | undefined;
let lastError: string | undefined;
let waitTimer: NodeJS.Timeout | undefined;

const allowedHotkeys = new Set([
  'ctrl+c',
  'ctrl+v',
  'ctrl+a',
  'ctrl+z',
  'ctrl+s',
  'alt+tab',
  'enter',
  'escape',
  'tab'
]);

export function getDesktopAutomationStatus(): CapabilityStatus {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe') return { id: 'desktop_automation', status: 'blocked', message: '仅危险模式可用' };
  if (!cfg.capabilities.desktopAutomationEnabled) return { id: 'desktop_automation', status: 'disabled', message: '未启用桌面自动化' };
  if (cfg.automation.desktopAutomationProvider === 'none') {
    return { id: 'desktop_automation', status: 'disabled', message: '未选择桌面自动化 provider' };
  }
  if (cfg.automation.desktopAutomationProvider === 'powershell') {
    return { id: 'desktop_automation', status: 'available', message: 'PowerShell provider 已启用' };
  }
  return { id: 'desktop_automation', status: 'not_installed', message: 'nutjs provider 尚未安装/实现' };
}

export async function runDesktopAutomationQueue(request: DesktopAutomationQueueRequest) {
  if (running) throw new Error('已有桌面自动化队列在运行');
  const actions = normalizeActions(request.actions);
  if (request.dryRun) return { ok: true, dryRun: true, actions };
  ensureAllowed();
  const cfg = getConfig();
  if (cfg.automation.desktopAutomationProvider !== 'powershell') throw new Error('当前仅实现 powershell provider');

  running = true;
  abortRequested = false;
  startedAt = Date.now();
  currentIndex = undefined;
  totalActions = actions.length;
  completedActions = 0;
  currentAction = undefined;
  lastError = undefined;

  try {
    for (let i = 0; i < actions.length; i++) {
      if (abortRequested) throw new Error('桌面自动化队列已停止');
      currentIndex = i;
      currentAction = actions[i];
      await executeAction(actions[i]);
      completedActions++;
    }
    return { ok: true, completedActions, totalActions };
  } catch (e: any) {
    lastError = e?.message ?? String(e);
    throw e;
  } finally {
    running = false;
    currentAction = undefined;
    currentIndex = undefined;
    startedAt = undefined;
    if (waitTimer) windowlessClearTimeout(waitTimer);
    waitTimer = undefined;
  }
}

export async function desktopMoveMouse(args: { x: number; y: number }) {
  ensureAllowed();
  validateCoord(args.x, args.y);
  const cfg = getConfig();
  if (cfg.automation.desktopAutomationProvider !== 'powershell') throw new Error('当前仅实现 powershell provider');
  return runPowerShell(powerShellMoveMouse(args.x, args.y));
}

export async function desktopClick(args: { x: number; y: number; button?: 'left' | 'right' | 'middle' }) {
  return runDesktopAutomationQueue({ actions: [{ type: 'click', x: args.x, y: args.y, button: args.button }] });
}

export async function desktopTypeText(args: { text: string }) {
  return runDesktopAutomationQueue({ actions: [{ type: 'typeText', text: args.text }] });
}

export async function desktopHotkey(args: { hotkey: string }) {
  return runDesktopAutomationQueue({ actions: [{ type: 'hotkey', hotkey: args.hotkey }] });
}

export function getDesktopAutomationRuntimeStatus(): CapabilityRuntimeStatus {
  const cfg = getConfig();
  const progress = totalActions ? `${completedActions}/${totalActions}` : undefined;
  return {
    id: 'desktop_automation',
    running,
    detail: running
      ? `queue ${progress} · ${currentAction ? JSON.stringify(currentAction) : '准备中'}`
      : cfg.automation.desktopAutomationProvider === 'none'
        ? '未选择 provider'
        : `${cfg.automation.desktopAutomationProvider} provider`,
    startedAt,
    lastError: lastError ?? (abortRequested ? '已收到停止请求' : undefined)
  };
}

export async function stopDesktopAutomation(): Promise<void> {
  abortRequested = true;
  if (waitTimer) windowlessClearTimeout(waitTimer);
  waitTimer = undefined;
}

function ensureAllowed(): void {
  const decision = checkDesktopAutomation();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
}

function normalizeActions(actions: DesktopAutomationAction[]): DesktopAutomationAction[] {
  if (!Array.isArray(actions) || actions.length === 0) throw new Error('actions 必须是非空数组');
  if (actions.length > 50) throw new Error('单次队列最多 50 个动作');
  return actions.map((action) => validateAction(action));
}

function validateAction(action: DesktopAutomationAction): DesktopAutomationAction {
  if (!action || typeof action !== 'object') throw new Error('动作必须是 object');
  if (action.type === 'click') {
    validateCoord(action.x, action.y);
    if (action.button && !['left', 'right', 'middle'].includes(action.button)) throw new Error('不支持的鼠标按钮');
    return { type: 'click', x: action.x, y: action.y, button: action.button ?? 'left' };
  }
  if (action.type === 'typeText') {
    const text = String(action.text ?? '');
    if (text.length > 500) throw new Error('单次输入文本最多 500 字符');
    return { type: 'typeText', text };
  }
  if (action.type === 'hotkey') {
    const hotkey = String(action.hotkey ?? '').toLowerCase();
    if (!allowedHotkeys.has(hotkey)) throw new Error(`不在热键白名单: ${hotkey}`);
    return { type: 'hotkey', hotkey };
  }
  if (action.type === 'wait') {
    const ms = Math.max(0, Math.min(Number(action.ms), 60_000));
    if (!Number.isFinite(ms)) throw new Error('wait.ms 必须是数字');
    return { type: 'wait', ms };
  }
  throw new Error(`不支持的动作类型: ${(action as any).type}`);
}

function validateCoord(x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('坐标必须是数字');
  if (x < 0 || y < 0 || x > 20000 || y > 20000) throw new Error('坐标超出允许范围');
}

async function executeAction(action: DesktopAutomationAction): Promise<void> {
  if (action.type === 'wait') return interruptibleWait(action.ms);
  if (action.type === 'click') return runPowerShell(powerShellClick(action.x, action.y, action.button ?? 'left'));
  if (action.type === 'typeText') return runPowerShell(powerShellTypeText(action.text));
  if (action.type === 'hotkey') return runPowerShell(powerShellHotkey(action.hotkey));
}

function interruptibleWait(ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    waitTimer = setTimeout(() => {
      waitTimer = undefined;
      abortRequested ? reject(new Error('桌面自动化队列已停止')) : resolve();
    }, ms);
  });
}

function runPowerShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      shell: false
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4000);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (abortRequested) reject(new Error('桌面自动化队列已停止'));
      else if (code === 0) resolve();
      else reject(new Error(`PowerShell provider 退出 code=${code}${stderr ? ` stderr=${stderr}` : ''}`));
    });
  });
}

function powerShellMoveMouse(x: number, y: number): string {
  return `Add-Type -Namespace Native -Name Mouse -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);'; [Native.Mouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})`;
}

function powerShellClick(x: number, y: number, button: 'left' | 'right' | 'middle'): string {
  const flag = button === 'right' ? '0x0008; $up = 0x0010' : button === 'middle' ? '0x0020; $up = 0x0040' : '0x0002; $up = 0x0004';
  return `[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); Add-Type -Namespace Native -Name Mouse -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);'; [Native.Mouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}); $down = ${flag}; [Native.Mouse]::mouse_event($down, 0, 0, 0, 0); Start-Sleep -Milliseconds 50; [Native.Mouse]::mouse_event($up, 0, 0, 0, 0)`;
}

function powerShellTypeText(text: string): string {
  const encoded = Buffer.from(text, 'utf16le').toString('base64');
  return `[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $text = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')); [System.Windows.Forms.SendKeys]::SendWait($text)`;
}

function powerShellHotkey(hotkey: string): string {
  const sendKey = hotkeyToSendKeys(hotkey);
  return `[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.SendKeys]::SendWait('${sendKey}')`;
}

function hotkeyToSendKeys(hotkey: string): string {
  const map: Record<string, string> = {
    'ctrl+c': '^c',
    'ctrl+v': '^v',
    'ctrl+a': '^a',
    'ctrl+z': '^z',
    'ctrl+s': '^s',
    'alt+tab': '%{TAB}',
    enter: '{ENTER}',
    escape: '{ESC}',
    tab: '{TAB}'
  };
  return map[hotkey];
}

function windowlessClearTimeout(timer: NodeJS.Timeout): void {
  clearTimeout(timer);
}
