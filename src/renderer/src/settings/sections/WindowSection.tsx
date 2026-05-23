import { useEffect, useState } from 'react';
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
  const [live2dPath, setLive2dPath] = useState(cfg.panel?.live2dModelPath ?? '');
  const [autoLaunch, setAutoLaunch] = useState(cfg.autoLaunch ?? false);
  const [msg, setMsg] = useState('');

  // 同步操作系统真实状态 (用户可能在系统设置里改过)
  useEffect(() => {
    void (async () => {
      const real = await window.api.getAutoLaunch();
      setAutoLaunch(real);
    })();
  }, []);

  const save = async () => {
    const realAuto = await window.api.setAutoLaunch(autoLaunch);
    await window.api.setConfig({
      window: { alwaysOnTop, petSize },
      panel: { live2dModelPath: live2dPath.trim() },
      autoLaunch: realAuto
    });
    await window.api.reloadPetWindow();
    setMsg(`已保存. 开机自启: ${realAuto ? '已开启' : '已关闭'}`);
    onChange();
  };

  return (
    <div className="section">
      <h2>窗口</h2>
      <p className="muted">改动会重建桌宠窗口以应用; 全屏面板需重新打开生效。</p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={alwaysOnTop}
          onChange={(e) => setAlwaysOnTop(e.target.checked)}
        />
        始终置顶 (在所有窗口之上)
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={autoLaunch}
          onChange={(e) => setAutoLaunch(e.target.checked)}
        />
        开机自启 (写入操作系统登录项)
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

      <h3 style={{ marginTop: 24 }}>全屏面板</h3>
      <p className="muted" style={{ fontSize: 12.5 }}>
        从托盘菜单或桌宠输入条上的"面板"按钮可打开. 立绘槽现支持静态图 (png/jpg/gif/webp) —
        Live2D Web SDK 接入是后续工作.
      </p>
      <label>
        立绘文件路径 (绝对路径)
        <input
          value={live2dPath}
          onChange={(e) => setLive2dPath(e.target.value)}
          placeholder="例如 D:\\art\\夜梦.png"
        />
      </label>

      <div className="form-actions" style={{ marginTop: 20 }}>
        <button className="primary" onClick={save}>保存并应用</button>
        <button onClick={() => window.api.openPanel()}>打开全屏面板</button>
      </div>
      {msg && <div className="test-msg">{msg}</div>}

      <h3 style={{ marginTop: 32 }}>即将上线</h3>
      <ul className="muted">
        <li>全局快捷键 (呼出输入框 / 切换人设 / 全屏面板)</li>
        <li>Live2D Web SDK 接入 (动态立绘 + 口型同步)</li>
      </ul>
    </div>
  );
}
