import { useState } from 'react';
import { nanoid } from 'nanoid';
import type { AppConfig, ProviderConfig, ProviderType } from '../../../../shared/types';

const TYPE_LABELS: Record<ProviderType, string> = {
  'openai-compatible': 'OpenAI 兼容 (GPT/DeepSeek/Qwen/Moonshot/Ollama/反代)',
  anthropic: 'Anthropic Claude (官方或反代)',
  gemini: 'Google Gemini (官方或反代)'
};

const DEFAULT_URLS: Record<ProviderType, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com'
};

const MODEL_PLACEHOLDER: Record<ProviderType, string> = {
  'openai-compatible': '例如: gpt-4o-mini / deepseek-chat / qwen-max',
  anthropic: '例如: claude-sonnet-4-6 / claude-opus-4-7 / claude-haiku-4-5-20251001',
  gemini: '例如: gemini-2.0-flash / gemini-2.5-pro'
};

export default function ProvidersSection({
  cfg,
  onChange
}: {
  cfg: AppConfig;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  const [testMsg, setTestMsg] = useState<string>('');

  const startNew = () => {
    setEditing({
      id: nanoid(8),
      name: '',
      type: 'openai-compatible',
      baseUrl: DEFAULT_URLS['openai-compatible'],
      apiKey: '',
      model: ''
    });
    setTestMsg('');
  };

  const startEdit = (p: ProviderConfig) => {
    setEditing({ ...p });
    setTestMsg('');
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.baseUrl.trim() || !editing.model.trim()) {
      setTestMsg('名称 / Base URL / 模型 不能为空');
      return;
    }
    const exists = cfg.providers.some((p) => p.id === editing.id);
    const next = exists
      ? cfg.providers.map((p) => (p.id === editing.id ? editing : p))
      : [...cfg.providers, editing];
    await window.api.setConfig({
      providers: next,
      activeProviderId: cfg.activeProviderId ?? editing.id
    });
    setEditing(null);
    setTestMsg('');
    onChange();
  };

  const remove = async (id: string) => {
    if (!confirm('确认删除这个 provider 吗?')) return;
    const next = cfg.providers.filter((p) => p.id !== id);
    await window.api.setConfig({
      providers: next,
      activeProviderId: cfg.activeProviderId === id ? (next[0]?.id ?? null) : cfg.activeProviderId
    });
    onChange();
  };

  const setActive = async (id: string) => {
    await window.api.setConfig({ activeProviderId: id });
    onChange();
  };

  const test = async () => {
    if (!editing) return;
    // 先临时保存(覆盖式), 再调测试
    const exists = cfg.providers.some((p) => p.id === editing.id);
    const next = exists
      ? cfg.providers.map((p) => (p.id === editing.id ? editing : p))
      : [...cfg.providers, editing];
    await window.api.setConfig({ providers: next });
    setTestMsg('测试中…');
    const r = await window.api.testProvider(editing.id);
    setTestMsg((r.ok ? '✓ ' : '✗ ') + r.message);
  };

  const fetchModels = async () => {
    if (!editing) return;
    setTestMsg('查询模型列表中…');
    const list = await window.api.listProviderModels(editing);
    if (!list || list.length === 0) {
      setTestMsg('未能获取模型列表(此 endpoint 可能不支持 GET /models)。请手动填入模型名。');
      return;
    }
    setTestMsg(`已获取 ${list.length} 个模型: ${list.slice(0, 8).join(', ')}${list.length > 8 ? '…' : ''}`);
  };

  return (
    <div className="section">
      <h2>API 提供商</h2>
      <p className="muted">
        所有 API key 仅保存在本地配置文件。可填官方地址或任何反代地址。支持 OpenAI 兼容协议、
        Anthropic Messages API、Google Gemini 三种.
      </p>

      <div className="provider-list">
        {cfg.providers.length === 0 && (
          <div className="empty">尚未配置任何 provider。点击右上角"添加"开始。</div>
        )}
        {cfg.providers.map((p) => (
          <div key={p.id} className={`provider-card ${cfg.activeProviderId === p.id ? 'active' : ''}`}>
            <div className="provider-head">
              <div className="provider-name">
                {p.name || '(未命名)'}{' '}
                {cfg.activeProviderId === p.id && <span className="tag">激活</span>}
              </div>
              <div className="provider-actions">
                {cfg.activeProviderId !== p.id && (
                  <button onClick={() => setActive(p.id)}>设为激活</button>
                )}
                <button onClick={() => startEdit(p)}>编辑</button>
                <button className="danger" onClick={() => remove(p.id)}>删除</button>
              </div>
            </div>
            <div className="provider-meta">
              <span className="muted">{TYPE_LABELS[p.type]}</span> ·{' '}
              <span className="muted">{p.baseUrl}</span> · <span>{p.model}</span>
            </div>
          </div>
        ))}
      </div>

      <button className="primary" style={{ marginTop: 12 }} onClick={startNew}>
        + 添加 Provider
      </button>

      {editing && (
        <div className="form-card" style={{ marginTop: 20 }}>
          <h3>{cfg.providers.some((p) => p.id === editing.id) ? '编辑 Provider' : '新建 Provider'}</h3>
          <label>
            显示名称
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="例如: DeepSeek 主号 / 公司 GPT 反代"
            />
          </label>
          <label>
            类型
            <select
              value={editing.type}
              onChange={(e) => {
                const t = e.target.value as ProviderType;
                setEditing({ ...editing, type: t, baseUrl: DEFAULT_URLS[t] });
              }}
            >
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Base URL (含 /v1 路径前缀, 反代地址也填这)
            <input
              value={editing.baseUrl}
              onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={editing.apiKey}
              onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </label>
          <label>
            模型名
            <input
              value={editing.model}
              onChange={(e) => setEditing({ ...editing, model: e.target.value })}
              placeholder={MODEL_PLACEHOLDER[editing.type]}
            />
          </label>
          <div className="form-actions">
            <button onClick={save} className="primary">保存</button>
            <button onClick={test}>测试连接</button>
            <button onClick={fetchModels}>获取模型列表</button>
            <button className="ghost" onClick={() => { setEditing(null); setTestMsg(''); }}>取消</button>
          </div>
          {testMsg && <div className="test-msg">{testMsg}</div>}
        </div>
      )}
    </div>
  );
}
