// 权限闸 — 所有能力执行前必须过这里
import { resolve, normalize, isAbsolute } from 'path';
import { getConfig } from './config';
import type { PermissionDecision, SafetyMode } from '../shared/types';

function inAnyDir(absPath: string, dirs: string[]): boolean {
  const p = normalize(absPath);
  for (const d of dirs) {
    const nd = normalize(d);
    if (p === nd) return true;
    const withSep = nd.endsWith('\\') || nd.endsWith('/') ? nd : nd + (process.platform === 'win32' ? '\\' : '/');
    if (p.toLowerCase().startsWith(withSep.toLowerCase())) return true;
  }
  return false;
}

function ensureAbsolute(p: string): string {
  return isAbsolute(p) ? p : resolve(p);
}

export function checkFileRead(path: string): PermissionDecision {
  const cfg = getConfig();
  const abs = ensureAbsolute(path);
  if (cfg.safetyMode === 'danger') return { ok: true };
  if (!inAnyDir(abs, cfg.capabilities.fileReadAllowDirs)) {
    return {
      ok: false,
      reason: `安全模式下, 读取必须在白名单目录内. 路径=${abs}, 白名单=${cfg.capabilities.fileReadAllowDirs.join(' | ')}`
    };
  }
  return { ok: true };
}

export function checkFileWrite(path: string): PermissionDecision {
  const cfg = getConfig();
  const abs = ensureAbsolute(path);
  if (cfg.safetyMode === 'danger') return { ok: true };
  if (!inAnyDir(abs, cfg.capabilities.fileWriteAllowDirs)) {
    return {
      ok: false,
      reason: `安全模式下, 写入必须在白名单目录内. 路径=${abs}, 白名单=${cfg.capabilities.fileWriteAllowDirs.join(' | ')}`
    };
  }
  return { ok: true };
}

export function checkShell(cmd: string): PermissionDecision {
  const cfg = getConfig();
  if (cfg.safetyMode === 'danger') return { ok: true };
  // 安全模式下: 提取首个 token 与白名单比对
  const head = (cmd.trim().split(/\s+/)[0] ?? '').toLowerCase();
  const cleaned = head.replace(/\.(exe|cmd|bat|ps1)$/i, '');
  if (cfg.capabilities.shellAllowList.map((s) => s.toLowerCase()).includes(cleaned)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `安全模式下, shell 命令 '${cleaned}' 不在白名单. 白名单=${cfg.capabilities.shellAllowList.join(', ')}`
  };
}

export function checkScreenCapture(): PermissionDecision {
  const cfg = getConfig();
  if (cfg.safetyMode === 'danger') return { ok: true };
  // 安全模式下: 默认要求弹窗确认 (这里只是 gate, 实际弹窗由调用方负责)
  if (cfg.capabilities.screenCaptureRequireConfirm) {
    // 仍然允许, 但调用方应当弹确认 — 由能力实现决定
    return { ok: true };
  }
  return { ok: true };
}

export function checkPlaywright(): PermissionDecision {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe') {
    return { ok: false, reason: '浏览器自动化仅在危险模式下可用.' };
  }
  if (!cfg.capabilities.playwrightEnabled) {
    return { ok: false, reason: '危险模式下也需在设置中单独启用 Playwright.' };
  }
  return { ok: true };
}

export function checkMemoryRW(): PermissionDecision {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe') {
    return { ok: false, reason: '游戏内存读写仅在危险模式下可用.' };
  }
  if (!cfg.capabilities.memoryRWEnabled) {
    return { ok: false, reason: '危险模式下也需在设置中单独启用内存读写.' };
  }
  return { ok: true };
}

export function checkMcp(): PermissionDecision {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe') {
    return { ok: false, reason: 'MCP 插件仅在危险模式下可用.' };
  }
  if (!cfg.capabilities.mcpEnabled) {
    return { ok: false, reason: '危险模式下也需在设置中单独启用 MCP 插件.' };
  }
  return { ok: true };
}

export function checkMaa(): PermissionDecision {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe') {
    return { ok: false, reason: 'MAA / MaaFramework 自动化仅在危险模式下可用.' };
  }
  if (!cfg.capabilities.maaEnabled) {
    return { ok: false, reason: '危险模式下也需在设置中单独启用 MAA / MaaFramework.' };
  }
  return { ok: true };
}

export function checkCliAnything(): PermissionDecision {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe') {
    return { ok: false, reason: 'CLI-Anything 外部工具仅在危险模式下可用.' };
  }
  if (!cfg.capabilities.cliAnythingEnabled) {
    return { ok: false, reason: '危险模式下也需在设置中单独启用 CLI-Anything.' };
  }
  return { ok: true };
}

export function checkDesktopAutomation(): PermissionDecision {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe') {
    return { ok: false, reason: '桌面自动化仅在危险模式下可用.' };
  }
  if (!cfg.capabilities.desktopAutomationEnabled) {
    return { ok: false, reason: '危险模式下也需在设置中单独启用桌面自动化.' };
  }
  return { ok: true };
}

export function checkScreenObservation(): PermissionDecision {
  const cfg = getConfig();
  if (cfg.safetyMode === 'danger') return { ok: true };
  if (!cfg.capabilities.screenObservationEnabled) {
    return { ok: false, reason: '安全模式下需在设置中单独启用连续屏幕观察.' };
  }
  return { ok: true };
}

export function isMode(mode: SafetyMode): boolean {
  return getConfig().safetyMode === mode;
}
