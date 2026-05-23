import { useEffect, useState } from 'react';
import type { AppConfig, PersonaMeta } from '../../../shared/types';
import ProvidersSection from './sections/ProvidersSection';
import PersonaSection from './sections/PersonaSection';
import ProfileSection from './sections/ProfileSection';
import WindowSection from './sections/WindowSection';
import SafetySection from './sections/SafetySection';
import ClaudeCodeSection from './sections/ClaudeCodeSection';
import MemorySection from './sections/MemorySection';

type Tab =
  | 'providers'
  | 'persona'
  | 'profile'
  | 'memory'
  | 'safety'
  | 'claudecode'
  | 'window'
  | 'about';

export default function Settings() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  const [tab, setTab] = useState<Tab>('providers');

  const refresh = async () => {
    const [c, ps] = await Promise.all([window.api.getConfig(), window.api.listPersonas()]);
    setCfg(c);
    setPersonas(ps);
  };

  useEffect(() => {
    refresh();
  }, []);

  if (!cfg) return <div style={{ padding: 20 }}>加载中…</div>;

  return (
    <div className="settings-root">
      <aside className="settings-nav">
        <div className="brand">九十九夜梦</div>
        <NavBtn active={tab === 'providers'} onClick={() => setTab('providers')}>API 提供商</NavBtn>
        <NavBtn active={tab === 'persona'} onClick={() => setTab('persona')}>人设</NavBtn>
        <NavBtn active={tab === 'profile'} onClick={() => setTab('profile')}>用户 Profile</NavBtn>
        <NavBtn active={tab === 'memory'} onClick={() => setTab('memory')}>记忆</NavBtn>
        <NavBtn active={tab === 'safety'} onClick={() => setTab('safety')}>
          安全模式 {cfg.safetyMode === 'danger' ? '⚠' : ''}
        </NavBtn>
        <NavBtn active={tab === 'claudecode'} onClick={() => setTab('claudecode')}>
          Claude Code
        </NavBtn>
        <NavBtn active={tab === 'window'} onClick={() => setTab('window')}>窗口</NavBtn>
        <NavBtn active={tab === 'about'} onClick={() => setTab('about')}>关于</NavBtn>
        <div style={{ flex: 1 }} />
        <div className="version-tag">v0.1.0 · MVP</div>
      </aside>

      <main className="settings-main">
        {tab === 'providers' && <ProvidersSection cfg={cfg} onChange={refresh} />}
        {tab === 'persona' && (
          <PersonaSection cfg={cfg} personas={personas} onChange={refresh} />
        )}
        {tab === 'profile' && <ProfileSection cfg={cfg} onChange={refresh} />}
        {tab === 'memory' && <MemorySection />}
        {tab === 'safety' && <SafetySection cfg={cfg} onChange={refresh} />}
        {tab === 'claudecode' && <ClaudeCodeSection cfg={cfg} onChange={refresh} />}
        {tab === 'window' && <WindowSection cfg={cfg} onChange={refresh} />}
        {tab === 'about' && <AboutSection />}
      </main>
    </div>
  );
}

function NavBtn({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`nav-btn ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function AboutSection() {
  return (
    <div className="section">
      <h2>关于</h2>
      <p>
        九十九夜梦 · 桌宠助手 <span className="muted">(reader-pet)</span>
      </p>
      <p className="muted">
        从酒馆角色卡《读者核心本体》改编为桌宠形态。 4 套人设 + Claude Code 集成 + 可选 GPT-SoVITS
        TTS。
      </p>
      <p className="muted">仓库: github.com/Adirm007/reader-pet</p>
      <p className="muted">本工具仅供个人使用与小范围分享, 不分发任何 API key。</p>
      <h3 style={{ marginTop: 24 }}>即将上线</h3>
      <ul className="muted">
        <li>每日来信 + 话痨模式</li>
        <li>GPT-SoVITS TTS 接入</li>
        <li>全屏面板 + Live2D 立绘槽</li>
      </ul>
    </div>
  );
}
