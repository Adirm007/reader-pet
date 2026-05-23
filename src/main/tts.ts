// GPT-SoVITS TTS 客户端 (可选层)
//
// 设计:
//   - 仅本地: 默认 baseUrl http://127.0.0.1:9880 (GPT-SoVITS api_v2 默认端口)
//   - 任何错误都静默降级 — TTS 失败不影响文字气泡的显示
//   - 不预启动 / 不嵌入模型 — 用户自己启动 GPT-SoVITS server, 这边只是 HTTP 客户端
//   - 不传 API key (本地服务无需鉴权; 反代场景留 extraHeaders 后续加)
import { getConfig } from './config';

export interface SynthesizeOk {
  ok: true;
  base64: string;            // base64 wav
  mime: string;              // "audio/wav"
}
export interface SynthesizeFail {
  ok: false;
  reason: string;
}
export type SynthesizeResult = SynthesizeOk | SynthesizeFail;

/**
 * 调 GPT-SoVITS /tts (POST, JSON body, 返回原始 wav 字节)
 * 字段名遵循 GPT-SoVITS api_v2: text/text_lang/ref_audio_path/prompt_text/prompt_lang/speed_factor
 */
export async function synthesize(text: string): Promise<SynthesizeResult> {
  const cfg = getConfig();
  const t = (cfg.tts ?? null) as ReturnType<typeof getConfig>['tts'] | null;
  if (!t || !t.enabled) return { ok: false, reason: 'tts 未启用' };
  const trimmed = text?.trim();
  if (!trimmed) return { ok: false, reason: '文本为空' };
  if (!t.baseUrl) return { ok: false, reason: '未配置 baseUrl' };

  const body: Record<string, unknown> = {
    text: trimmed,
    text_lang: t.textLang || 'zh',
    prompt_lang: t.promptLang || 'zh',
    speed_factor: t.speedFactor || 1.0,
    media_type: 'wav',
    streaming_mode: false
  };
  if (t.refAudioPath) body.ref_audio_path = t.refAudioPath;
  if (t.promptText) body.prompt_text = t.promptText;

  const url = t.baseUrl.replace(/\/+$/, '') + '/tts';
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      let errText = '';
      try {
        errText = (await resp.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      return { ok: false, reason: `HTTP ${resp.status}: ${errText}` };
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength < 64) {
      return { ok: false, reason: '返回数据过短, 可能不是音频' };
    }
    return {
      ok: true,
      base64: buf.toString('base64'),
      mime: 'audio/wav'
    };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
}

/** ping /health 或 / 看看服务在不在 (尽力而为) */
export async function pingTTS(): Promise<{ ok: boolean; message: string }> {
  const cfg = getConfig();
  const t = cfg.tts;
  if (!t || !t.baseUrl) return { ok: false, message: '未配置 baseUrl' };
  const url = t.baseUrl.replace(/\/+$/, '') + '/';
  try {
    const resp = await fetch(url, { method: 'GET' });
    return { ok: resp.ok, message: `HTTP ${resp.status}` };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? String(e) };
  }
}
