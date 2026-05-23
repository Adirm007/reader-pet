import { useState } from 'react';
import type { AppConfig } from '../../../../shared/types';

export default function WindowSection({
  cfg,
  onChange
}: {
  cfg: AppConfig;
  onChange: () => void;
}) {
  const [alwaysOnTop, setAlwaysOnTop] = useState(cfg.window.alwaysOnTop);
  const [petSize, setPetSize] = useState(cfg.window.petSize);

  const save = async () => {
    await window.api.setConfig({ window: { alwaysOnTop, petSize } });
    await window.api.reloadPetWindow();
    onChange();
  };

  return (
    <div className="section">
      <h2>窗口</h2>
      <p className="muted">改动会重建桌宠窗口以应用。</p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={alwaysOnTop}
          onChange={(e) => setAlwaysOnTop(e.target.checked)}
        />
        始终置顶 (在所有窗口之上)
      </label>

      <label>
        桌宠尺寸: {petSize}%
        <input
          type="range"
          min={50}
          max={150}
          step={5}
          value={petSize}
          onChange={(e) => setPetSize(Number(e.target.value))}
        />
      </label>

      <div className="form-actions" style={{ marginTop: 20 }}>
        <button className="primary" onClick={save}>保存并应用</button>
      </div>

      <h3 style={{ marginTop: 32 }}>即将上线</h3>
      <ul className="muted">
        <li>开机自启动开关</li>
        <li>全局快捷键 (呼出输入框 / 切换人设 / 全屏面板)</li>
        <li>全屏面板模式 (带 Live2D 立绘槽)</li>
      </ul>
    </div>
  );
}
