import { useEffect, useState } from 'react';
import type { AppConfig, PetSpritePackage, PetState } from '../../../../shared/types';
import PetSprite from '../../components/PetSprite';

const PREVIEW_STATES: PetState[] = ['idle', 'talk', 'think', 'happy', 'sleep', 'failed'];

export default function PetSpriteSection({
  cfg,
  onChange
}: {
  cfg: AppConfig;
  onChange: () => void;
}) {
  const [list, setList] = useState<Array<{ id: string; displayName: string; description?: string }>>([]);
  const [activeId, setActiveId] = useState(cfg.petSprite?.activePackageId ?? '');
  const [fpsMultiplier, setFpsMultiplier] = useState<number>(cfg.petSprite?.fpsMultiplier ?? 0.6);
  const [pkg, setPkg] = useState<PetSpritePackage | null>(null);
  const [preview, setPreview] = useState<PetState>('idle');
  const [msg, setMsg] = useState('');

  const reloadList = async () => {
    const ls = await window.api.petSpriteList();
    setList(ls);
  };

  useEffect(() => {
    reloadList();
  }, []);

  useEffect(() => {
    (async () => {
      if (!activeId) {
        setPkg(null);
        return;
      }
      const p = await window.api.petSpriteLoad(activeId);
      setPkg(p);
    })();
  }, [activeId]);

  const save = async () => {
    await window.api.setConfig({
      petSprite: {
        activePackageId: activeId,
        defaultFps: cfg.petSprite?.defaultFps ?? 8,
        fpsMultiplier
      }
    });
    await window.api.reloadPetWindow();
    setMsg('已保存. 桌宠窗口已重建以加载新精灵图.');
    onChange();
  };

  return (
    <div className="section">
      <h2>桌宠精灵图</h2>
      <p className="muted">
        把 hatch-pet (Codex) 输出的精灵图包丢进资源目录, 这里选中即可让桌宠获得动作动画.
        每个包就是一个文件夹, 内含 <code>pet.json</code> + <code>spritesheet.webp</code>.
        没装包时, 桌宠回退为内置银发紫眸 SVG 占位.
      </p>

      <div className="form-actions" style={{ marginBottom: 12 }}>
        <button onClick={reloadList}>重新扫描</button>
        <button
          className="ghost"
          onClick={async () => {
            const dir = await window.api.petSpriteOpenUserDir();
            setMsg(`已打开本机精灵图目录: ${dir}`);
          }}
        >
          打开本机精灵图目录
        </button>
      </div>

      <label>
        当前精灵图包
        <select value={activeId} onChange={(e) => setActiveId(e.target.value)}>
          <option value="">(不使用, 用内置 SVG 占位)</option>
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} — {p.id}
            </option>
          ))}
        </select>
      </label>

      <label>
        播放速度倍率 · 当前 {fpsMultiplier.toFixed(2)}×
        <input
          type="range"
          min={0.3}
          max={1.5}
          step={0.05}
          value={fpsMultiplier}
          onChange={(e) => setFpsMultiplier(parseFloat(e.target.value))}
        />
        <span className="muted" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
          0.3 ≈ 慢动作, 1.0 = 包内 fps 原速, 1.5 = 快进. 默认 0.6 (放慢, 避免鬼畜).
        </span>
      </label>

      {list.length === 0 && (
        <p className="muted" style={{ fontSize: 12.5 }}>
          还没扫描到任何精灵图包. 操作步骤: ① 在 Codex 里跑 hatch-pet skill, 把头像作为参考图;
          ② 把它在 <code>~/.codex/pets/&lt;name&gt;/</code> 下产出的整个目录,
          拷到本机精灵图目录 (上面按钮可以打开) 或仓库的 <code>resources/pet-sprites/</code>;
          ③ 回这里点"重新扫描".
        </p>
      )}

      {pkg && (
        <div style={{ marginTop: 16 }}>
          <h3>预览</h3>
          <div className="form-actions" style={{ flexWrap: 'wrap' }}>
            {PREVIEW_STATES.map((s) => (
              <button
                key={s}
                className={preview === s ? 'primary' : 'ghost'}
                onClick={() => setPreview(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div
            style={{
              marginTop: 12,
              padding: 16,
              background: '#222',
              borderRadius: 8,
              display: 'inline-block'
            }}
          >
            <PetSprite pkg={pkg} state={preview} displayWidth={192} fpsMultiplier={fpsMultiplier} />
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            cells: {pkg.cellWidth}×{pkg.cellHeight} · 网格: {pkg.cols} 列 × {pkg.rows} 行 · clip:
            row {pkg.clips[preview]?.row}, {pkg.clips[preview]?.frames} 帧, {pkg.clips[preview]?.fps} fps
          </p>
        </div>
      )}

      <div className="form-actions" style={{ marginTop: 20 }}>
        <button className="primary" onClick={save}>保存并应用</button>
      </div>
      {msg && <div className="test-msg">{msg}</div>}

      <h3 style={{ marginTop: 32 }}>状态映射 (写在 pet.json 里可覆盖)</h3>
      <ul className="muted" style={{ fontSize: 12.5 }}>
        <li><b>idle</b> ← hatch-pet row 0 idle · 默认待机</li>
        <li><b>talk</b> ← row 3 waving · TTS 播放中 / 等待回复</li>
        <li><b>think</b> ← row 7 running · (预留) Claude Code 工作中</li>
        <li><b>happy</b> ← row 4 jumping · 收到信 / 对话回复后 ~3s</li>
        <li><b>sleep</b> ← row 6 waiting · 5 分钟无交互</li>
        <li><b>failed</b> ← row 5 failed · 气泡含"错误/出错/失败"</li>
      </ul>
    </div>
  );
}
