import { useState } from 'react';
import type { AppConfig } from '../../../../shared/types';

export default function ProactiveSection({
  cfg,
  onChange
}: {
  cfg: AppConfig;
  onChange: () => void;
}) {
  const [letterEnabled, setLetterEnabled] = useState(cfg.dailyLetter.enabled);
  const [letterHour, setLetterHour] = useState(cfg.dailyLetter.hour);
  const [chatterEnabled, setChatterEnabled] = useState(cfg.chatter.enabled);
  const [minMin, setMinMin] = useState(cfg.chatter.minMinutes);
  const [maxMin, setMaxMin] = useState(cfg.chatter.maxMinutes);
  const [msg, setMsg] = useState('');

  const save = async () => {
    const safeMin = Math.max(1, Math.floor(minMin));
    const safeMax = Math.max(safeMin, Math.floor(maxMin));
    await window.api.setConfig({
      dailyLetter: { enabled: letterEnabled, hour: Math.max(0, Math.min(23, letterHour)) },
      chatter: { enabled: chatterEnabled, minMinutes: safeMin, maxMinutes: safeMax }
    });
    setMsg('已保存; 计时器已按新设置重排');
    onChange();
  };

  const tryLetter = async () => {
    setMsg('正在让夜梦写信…');
    const r = await window.api.triggerLetter();
    setMsg(r.ok ? '已推到桌宠气泡: ' + (r.text ?? '').slice(0, 80) : '失败: ' + r.reason);
  };
  const tryChatter = async () => {
    setMsg('正在让夜梦搭话…');
    const r = await window.api.triggerChatter();
    setMsg(r.ok ? '已推到桌宠气泡: ' + (r.text ?? '').slice(0, 80) : '失败: ' + r.reason);
  };

  return (
    <div className="section">
      <h2>主动行为</h2>
      <p className="muted">
        夜梦会在你没主动提问时, 也悄悄出现 — 一天一封信, 或者隔一阵搭一句话. 不会动你的系统;
        话痨模式只在桌宠气泡里说话.
      </p>

      <div className="form-card" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>一天一封信</h3>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={letterEnabled}
            onChange={(e) => setLetterEnabled(e.target.checked)}
          />
          启用每日来信
        </label>
        <label>
          投递时段 (大致小时, 0~23)
          <input
            type="number"
            min={0}
            max={23}
            value={letterHour}
            onChange={(e) => setLetterHour(Number(e.target.value))}
          />
        </label>
        <p className="muted" style={{ fontSize: 12 }}>
          每天首次到点后投递一封, 同日不会重复. 实际触发会随机延后几分钟避免整点.
        </p>
        <div className="form-actions">
          <button onClick={tryLetter}>立刻试写一封 (调用一次模型)</button>
        </div>
      </div>

      <div className="form-card">
        <h3 style={{ marginTop: 0 }}>话痨模式</h3>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={chatterEnabled}
            onChange={(e) => setChatterEnabled(e.target.checked)}
          />
          启用主动搭话
        </label>
        <label>
          最短间隔 (分钟)
          <input
            type="number"
            min={1}
            value={minMin}
            onChange={(e) => setMinMin(Number(e.target.value))}
          />
        </label>
        <label>
          最长间隔 (分钟)
          <input
            type="number"
            min={1}
            value={maxMin}
            onChange={(e) => setMaxMin(Number(e.target.value))}
          />
        </label>
        <p className="muted" style={{ fontSize: 12 }}>
          每次随机一个 [最短, 最长] 之间的间隔, 触发后再次随机. 你和桌宠对话后计时会重置.
          话痨发言只在气泡里, 不会触发任何系统操作.
        </p>
        <div className="form-actions">
          <button onClick={tryChatter}>立刻试搭一句 (调用一次模型)</button>
        </div>
      </div>

      <div className="form-actions" style={{ marginTop: 16 }}>
        <button className="primary" onClick={save}>保存</button>
      </div>
      {msg && <div className="test-msg">{msg}</div>}
    </div>
  );
}
