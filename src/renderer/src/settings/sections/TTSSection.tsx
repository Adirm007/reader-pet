import { useState } from 'react';
import type { AppConfig } from '../../../../shared/types';

export default function TTSSection({
  cfg,
  onChange
}: {
  cfg: AppConfig;
  onChange: () => void;
}) {
  const t = cfg.tts;
  const [enabled, setEnabled] = useState(t.enabled);
  const [baseUrl, setBaseUrl] = useState(t.baseUrl);
  const [refAudioPath, setRefAudioPath] = useState(t.refAudioPath);
  const [promptText, setPromptText] = useState(t.promptText);
  const [promptLang, setPromptLang] = useState(t.promptLang);
  const [textLang, setTextLang] = useState(t.textLang);
  const [speed, setSpeed] = useState(t.speedFactor);
  const [autoSpeak, setAutoSpeak] = useState(t.autoSpeakOnBubble);
  const [msg, setMsg] = useState('');

  const save = async () => {
    await window.api.setConfig({
      tts: {
        enabled,
        baseUrl: baseUrl.trim(),
        refAudioPath: refAudioPath.trim(),
        promptText: promptText.trim(),
        promptLang,
        textLang,
        speedFactor: Math.max(0.5, Math.min(2.0, Number(speed) || 1.0)),
        autoSpeakOnBubble: autoSpeak
      }
    });
    setMsg('已保存. (桌宠窗口需要重新加载才能让设置改动生效, 或重启应用)');
    onChange();
  };

  const ping = async () => {
    setMsg('正在 ping…');
    const r = await window.api.ttsPing();
    setMsg(r.ok ? `服务可达: ${r.message}` : `不可达: ${r.message}`);
  };

  const tryOnce = async () => {
    setMsg('正在合成测试句…');
    const r = await window.api.ttsSynthesize('测试一下声音, 作家先生.');
    if (!r.ok) {
      setMsg('合成失败: ' + r.reason);
      return;
    }
    try {
      const audio = new Audio(`data:${r.mime ?? 'audio/wav'};base64,${r.base64}`);
      await audio.play();
      setMsg('已播放 (若听不到, 检查参考音频路径与 GPT-SoVITS 服务日志)');
    } catch (e: any) {
      setMsg('播放失败: ' + (e?.message ?? String(e)));
    }
  };

  return (
    <div className="section">
      <h2>TTS · GPT-SoVITS (可选)</h2>
      <p className="muted">
        本工具不内置 TTS 模型. 你需要自己启动 GPT-SoVITS api_v2 服务 (默认端口 9880),
        本应用只是 HTTP 客户端, 失败时静默降级 — 不会影响文字气泡显示.
      </p>

      <div className="form-card">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          启用 TTS
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={autoSpeak}
            onChange={(e) => setAutoSpeak(e.target.checked)}
          />
          自动朗读 (每条桌宠气泡都会调一次合成)
        </label>

        <label>
          GPT-SoVITS Base URL
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://127.0.0.1:9880"
          />
        </label>

        <label>
          参考音频路径 (绝对路径, 服务端能读到的位置)
          <input
            value={refAudioPath}
            onChange={(e) => setRefAudioPath(e.target.value)}
            placeholder="例如 D:\\voices\\ref.wav"
          />
        </label>

        <label>
          参考音频对应的文字
          <input
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="参考音频里说的那句话"
          />
        </label>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1 }}>
            参考音频语种
            <select value={promptLang} onChange={(e) => setPromptLang(e.target.value)}>
              <option value="zh">中</option>
              <option value="en">英</option>
              <option value="ja">日</option>
              <option value="auto">auto</option>
            </select>
          </label>
          <label style={{ flex: 1 }}>
            合成文本语种
            <select value={textLang} onChange={(e) => setTextLang(e.target.value)}>
              <option value="zh">中</option>
              <option value="en">英</option>
              <option value="ja">日</option>
              <option value="auto">auto</option>
            </select>
          </label>
        </div>

        <label>
          语速倍率: {speed.toFixed(2)}
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>

        <div className="form-actions">
          <button onClick={ping}>Ping 服务</button>
          <button onClick={tryOnce}>合成并试听一句</button>
          <button className="primary" onClick={save}>保存</button>
        </div>
        {msg && <div className="test-msg">{msg}</div>}
      </div>

      <h3 style={{ marginTop: 20 }}>快速排错</h3>
      <ul className="muted" style={{ fontSize: 12.5 }}>
        <li>GPT-SoVITS api_v2 默认 9880, 启动命令一般是 python api_v2.py 或 runtime/python api_v2.py</li>
        <li>参考音频路径一定是 GPT-SoVITS 进程能读到的位置, 不是桌宠应用所在路径</li>
        <li>反代 / 共享给朋友的场景: 把 baseUrl 换成内网或反代地址即可</li>
        <li>不希望每条都朗读时, 关掉"自动朗读", 仅保留"启用 TTS" — 后续可挂手动播放按钮</li>
      </ul>
    </div>
  );
}
