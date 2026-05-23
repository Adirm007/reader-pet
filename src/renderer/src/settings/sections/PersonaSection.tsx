import type { AppConfig, PersonaMeta } from '../../../../shared/types';

export default function PersonaSection({
  cfg,
  personas,
  onChange
}: {
  cfg: AppConfig;
  personas: PersonaMeta[];
  onChange: () => void;
}) {
  const switchTo = async (id: string) => {
    await window.api.setConfig({ activePersonaId: id as AppConfig['activePersonaId'] });
    onChange();
  };

  return (
    <div className="section">
      <h2>人设</h2>
      <p className="muted">
        她有四副面孔, 切换时她会用对应的过渡台词出场。 同一时间仅一个人设激活。 切换会保留她对你的长期记忆
        (后续记忆系统上线后), 但短期对话窗口按人设隔离。
      </p>

      <div className="persona-grid">
        {personas.map((p) => (
          <div
            key={p.id}
            className={`persona-card ${cfg.activePersonaId === p.id ? 'active' : ''}`}
            onClick={() => switchTo(p.id)}
          >
            <div className="persona-name">
              {p.display_name}
              {cfg.activePersonaId === p.id && <span className="tag">激活</span>}
            </div>
            <div className="persona-id muted">id: {p.id}</div>
            <div className="persona-desc">{p.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
