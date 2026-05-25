// 屏幕截图 — 经过 permissions gate
import { desktopCapturer, BrowserWindow, dialog } from 'electron';
import type { CapabilityRuntimeStatus } from '../../shared/types';
import { checkScreenCapture, checkScreenObservation } from '../permissions';
import { getConfig } from '../config';

export interface ScreenCaptureResult {
  dataUrl: string;        // base64 image/png
  width: number;
  height: number;
}

let abortObservation = false;
let observationRunning = false;
let observationStartedAt: number | undefined;
let observationLastError: string | undefined;

export async function listScreenSources(): Promise<Array<{ id: string; name: string; width: number; height: number }>> {
  const decision = checkScreenCapture();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 320, height: 200 }
  });
  return sources.map((src) => {
    const size = src.thumbnail.getSize();
    return { id: src.id, name: src.name, width: size.width, height: size.height };
  });
}

export async function screenCapture(opts?: {
  requestingContext?: string;       // 用于确认弹窗显示给用户的上下文
  promptWindow?: BrowserWindow | null;
  sourceId?: string;
  skipConfirm?: boolean;
}): Promise<ScreenCaptureResult> {
  const decision = checkScreenCapture();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  if (!opts?.skipConfirm) await confirmScreenAccess(opts?.requestingContext, opts?.promptWindow);

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1280, height: 800 }
  });
  if (sources.length === 0) throw new Error('没有可用屏幕源');
  const sourceId = opts?.sourceId;
  const src = sourceId ? sources.find((item) => item.id === sourceId) : sources[0];
  if (!src) throw new Error(`未找到屏幕源: ${sourceId}`);
  const dataUrl = src.thumbnail.toDataURL();
  const size = src.thumbnail.getSize();
  return { dataUrl, width: size.width, height: size.height };
}

export async function observeScreenSequence(opts?: {
  requestingContext?: string;
  frames?: number;
  intervalMs?: number;
  sourceId?: string;
}): Promise<{ ok: boolean; frames: Array<{ ts: number; width: number; height: number; dataUrl: string }> }> {
  const decision = checkScreenObservation();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  const frames = Math.max(1, Math.min(Number(opts?.frames ?? 3), 10));
  const intervalMs = Math.max(300, Math.min(Number(opts?.intervalMs ?? 1000), 10_000));
  abortObservation = false;
  observationRunning = true;
  observationStartedAt = Date.now();
  observationLastError = undefined;
  try {
    await confirmScreenAccess(opts?.requestingContext ?? '连续屏幕观察', undefined);

    const result: Array<{ ts: number; width: number; height: number; dataUrl: string }> = [];
    for (let i = 0; i < frames; i += 1) {
      if (abortObservation) throw new Error('屏幕观察已被紧急停止');
      const frame = await screenCapture({ requestingContext: opts?.requestingContext, sourceId: opts?.sourceId, skipConfirm: true });
      result.push({ ts: Date.now(), ...frame });
      if (i < frames - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return { ok: true, frames: result };
  } catch (e: any) {
    observationLastError = e?.message ?? String(e);
    throw e;
  } finally {
    observationRunning = false;
    observationStartedAt = undefined;
  }
}

export function getScreenObservationRuntimeStatus(): CapabilityRuntimeStatus {
  return {
    id: 'screen_capture',
    running: observationRunning,
    detail: observationRunning ? 'screen observation' : undefined,
    startedAt: observationStartedAt,
    lastError: observationLastError
  };
}

export function stopScreenObservation(): void {
  abortObservation = true;
}

async function confirmScreenAccess(requestingContext?: string, promptWindow?: BrowserWindow | null): Promise<void> {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe' && cfg.capabilities.screenCaptureRequireConfirm) {
    const r = await dialog.showMessageBox(promptWindow ?? undefined as any, {
      type: 'question',
      title: '截屏请求',
      message: '夜梦请求查看屏幕内容',
      detail: requestingContext ?? '(未提供上下文)',
      buttons: ['允许', '拒绝'],
      defaultId: 1,
      cancelId: 1
    });
    if (r.response !== 0) {
      throw new Error('用户拒绝了截屏请求');
    }
  }
}
