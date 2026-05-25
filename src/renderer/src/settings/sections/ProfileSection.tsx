import { useState } from 'react';
import type { AppConfig } from '../../../../shared/types';

const ADDRESS_PRESETS = ['作家先生', '作家小姐', '主人', '我的作家'];

export default function ProfileSection({
  cfg,
  onChange
}: {
  cfg: AppConfig;
  onChange: () => void;
}) {
  const [address, setAddress] = useState(cfg.profile.preferredAddress);
  const [selfDesc, setSelfDesc] = useState(cfg.profile.selfDescription ?? '');
  const [facts, setFacts] = useState<string[]>(cfg.profile.customFacts);
  const [newFact, setNewFact] = useState('');

  const save = async () => {
    await window.api.setConfig({
      profile: {
        preferredAddress: address.trim() || '作家先生',
        selfDescription: selfDesc,
        customFacts: facts
      }
    });
    onChange();
  };

  const addFact = () => {
    const t = newFact.trim();
    if (!t) return;
    setFacts([...facts, t]);
    setNewFact('');
  };

  const removeFact = (i: number) => {
    setFacts(facts.filter((_, idx) => idx !== i));
  };

  return (
    <div className="section">
      <h2>用户 Profile</h2>
      <p className="muted">
        这些信息会被注入 system prompt, 让她知道如何称呼你、对你的了解、应当记得的关键事实。
        修改后请点底部"保存"。
      </p>

      <label>
        她对你的称呼
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
        <div className="preset-row">
          {ADDRESS_PRESETS.map((p) => (
            <button key={p} className="ghost mini" onClick={() => setAddress(p)}>
              {p}
            </button>
          ))}
        </div>
      </label>

      <label>
        简短自述 (可选, 让她对你有基础认知)
        <textarea
          rows={3}
          value={selfDesc}
          onChange={(e) => setSelfDesc(e.target.value)}
          placeholder="例如: 写作 + 编程兼修, 喜欢深夜工作, 不喜欢被打断"
        />
      </label>

      <h3 style={{ marginTop: 18 }}>她应当记得的事实</h3>
      <p className="muted">
        每条独立一行, 都会作为基础长期事实直接注入。 删除时她会真的忘记。 自动沉淀的语义事实请到「记忆系统」里查看和管理。
      </p>
      <ul className="fact-list">
        {facts.map((f, i) => (
          <li key={i}>
            <span>{f}</span>
            <button className="ghost mini" onClick={() => removeFact(i)}>删</button>
          </li>
        ))}
      </ul>
      <div className="add-fact-row">
        <input
          value={newFact}
          onChange={(e) => setNewFact(e.target.value)}
          placeholder="新增一条事实, 例如: 喜欢 Pocky"
          onKeyDown={(e) => e.key === 'Enter' && addFact()}
        />
        <button onClick={addFact}>添加</button>
      </div>

      <div className="form-actions" style={{ marginTop: 20 }}>
        <button className="primary" onClick={save}>保存</button>
      </div>
    </div>
  );
}
