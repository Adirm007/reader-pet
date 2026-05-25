import type { CapabilityRuntimeStatus, CapabilityStatus } from '../../shared/types';
import { getConfig } from '../config';
import { checkDesktopAutomation } from '../permissions';

let abortRequested = false;

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
  return { id: 'desktop_automation', status: 'not_installed', message: 'provider scaffold 已接入, 具体驱动尚未安装/实现' };
}

export async function desktopMoveMouse(args: { x: number; y: number }) {
  ensureAllowed();
  validateCoord(args.x, args.y);
  throw new Error('桌面自动化 provider 尚未实现. 请先配置并安装受支持 provider.');
}

export async function desktopClick(args: { x: number; y: number; button?: 'left' | 'right' | 'middle' }) {
  ensureAllowed();
  validateCoord(args.x, args.y);
  if (args.button && !['left', 'right', 'middle'].includes(args.button)) throw new Error('不支持的鼠标按钮');
  throw new Error('桌面自动化 provider 尚未实现. 请先配置并安装受支持 provider.');
}

export async function desktopTypeText(args: { text: string }) {
  ensureAllowed();
  if (String(args.text ?? '').length > 500) throw new Error('单次输入文本最多 500 字符');
  throw new Error('桌面自动化 provider 尚未实现. 请先配置并安装受支持 provider.');
}

export async function desktopHotkey(args: { hotkey: string }) {
  ensureAllowed();
  const hotkey = String(args.hotkey ?? '').toLowerCase();
  if (!allowedHotkeys.has(hotkey)) throw new Error(`不在热键白名单: ${hotkey}`);
  throw new Error('桌面自动化 provider 尚未实现. 请先配置并安装受支持 provider.');
}

export function getDesktopAutomationRuntimeStatus(): CapabilityRuntimeStatus {
  const cfg = getConfig();
  return {
    id: 'desktop_automation',
    running: false,
    detail: cfg.automation.desktopAutomationProvider === 'none'
      ? '未选择 provider'
      : `${cfg.automation.desktopAutomationProvider} provider 尚未实现`,
    lastError: abortRequested ? '已收到停止请求' : undefined
  };
}

export async function stopDesktopAutomation(): Promise<void> {
  abortRequested = true;
}

function ensureAllowed(): void {
  abortRequested = false;
  const decision = checkDesktopAutomation();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
}

function validateCoord(x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('坐标必须是数字');
  if (x < 0 || y < 0 || x > 20000 || y > 20000) throw new Error('坐标超出允许范围');
}
