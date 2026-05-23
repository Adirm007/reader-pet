// 屏幕截图 — 经过 permissions gate
import { desktopCapturer, BrowserWindow, dialog } from 'electron';
import { checkScreenCapture } from '../permissions';
import { getConfig } from '../config';

export interface ScreenCaptureResult {
  dataUrl: string;        // base64 image/png
  width: number;
  height: number;
}

export async function screenCapture(opts?: {
  requestingContext?: string;       // 用于确认弹窗显示给用户的上下文
  promptWindow?: BrowserWindow | null;
}): Promise<ScreenCaptureResult> {
  const decision = checkScreenCapture();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);

  const cfg = getConfig();
  if (cfg.safetyMode === 'safe' && cfg.capabilities.screenCaptureRequireConfirm) {
    const r = await dialog.showMessageBox(opts?.promptWindow ?? undefined as any, {
      type: 'question',
      title: '截屏请求',
      message: '夜梦请求查看屏幕内容',
      detail: opts?.requestingContext ?? '(未提供上下文)',
      buttons: ['允许', '拒绝'],
      defaultId: 1,
      cancelId: 1
    });
    if (r.response !== 0) {
      throw new Error('用户拒绝了截屏请求');
    }
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1280, height: 800 }
  });
  if (sources.length === 0) throw new Error('没有可用屏幕源');
  const src = sources[0];
  const dataUrl = src.thumbnail.toDataURL();
  const size = src.thumbnail.getSize();
  return { dataUrl, width: size.width, height: size.height };
}
