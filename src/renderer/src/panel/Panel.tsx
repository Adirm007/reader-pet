import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig, EpisodeRow, PersonaMeta } from '../../../shared/types';

interface ChatRow {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  persona_id?: string;
}

export default function Panel() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [live2dUrl, setLive2dUrl] = useState<string | null>(null);
  const [live2dErr, setLive2dErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 初始加载: 配置 + 人设 + 最近 60 条 episode
  useEffect(() => {
    void (async () => {
      const [c, ps, eps] = await Promise.all([
        window.api.getConfig(),
        window.api.listPersonas(),
        window.api.memRecentEpisodes(60)
      ]);
      setCfg(c);
      setPersonas(ps);
      setRows(
        eps.map((e: EpisodeRow) => ({
          id: e.id,
          role: e.role,
          content: e.content,
          ts: e.ts,
          persona_id: e.persona_id
        }))
      );
    })();
  }, []);

  // 立绘加载
  useEffect(() => {
    setLive2dUrl(null);
    setLive2dErr(null);
    const p = cfg?.panel?.live2dModelPath;
    if (!p) return;
    void (async () => {
      const r = await window.api.loadLive2dAsset(p);
      if (r.ok && r.dataUrl) setLive2dUrl(r.dataUrl);
      else setLive2dErr(r.reason ?? '未知');
    })();
  }, [cfg?.panel?.live2dModelPath]);

  // 推送的气泡也并入面板历史
  useEffect(() => {
    const off = window.api.onPetBubble((p) => {
      setRows((prev) => [
        ...prev,
        {
          id: -Date.now(),
          role: 'assistant',
          content: p.text,
          ts: p.ts,
          persona_id: cfg?.activePersonaId
        }
      ]);
    });
    return () => {
      off();
    };
  }, [cfg?.activePersonaId]);

  // 滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || pending) return;
    setPending(true);
    const userRow: ChatRow = {
      id: -Date.now(),
      role: 'user',
      content: text,
      ts: Date.now(),
      persona_id: cfg?.activePersonaId
    };
    setRows((prev) => [...prev, userRow]);
    setInput('');
    try {
      const resp = await window.api.sendChat(text);
      setRows((prev) => [
        ...prev,
        {
          id: -Date.now() - 1,
          role: 'assistant',
          content: resp.text || '(空响应)',
          ts: Date.now(),
          persona_id: cfg?.activePersonaId
        }
      ]);
    } catch (e: any) {
      setRows((prev) => [
        ...prev,
        {
          id: -Date.now() - 1,
          role: 'assistant',
          content: '(出错: ' + (e?.message ?? String(e)) + ')',
          ts: Date.now(),
          persona_id: cfg?.activePersonaId
        }
      ]);
    } finally {
      setPending(false);
    }
  }, [input, pending, cfg?.activePersonaId]);

  const switchPersona = async (id: PersonaMeta['id']) => {
    if (!cfg) return;
    await window.api.setConfig({ activePersonaId: id });
    const c = await window.api.getConfig();
    setCfg(c);
  };

  const clearHistory = async () => {
    if (!confirm('仅清空当前面板视图 (磁盘上的 Episode 记录不动)?')) return;
    setRows([]);
  };

  if (!cfg) return <div style={{ padding: 24 }}>加载中…</div>;

  return (
    <div className="panel-root">
      <aside className="panel-side">
        <div className="panel-portrait">
          {live2dUrl ? (
            <img src={live2dUrl} alt="立绘" />
          ) : (
            <div className="panel-portrait-empty">
              <div style={{ fontSize: 14, fontWeight: 600 }}>立绘槽</div>
              <div style={{ fontSize: 12, marginTop: 6, opacity: 0.7 }}>
                {live2dErr
                  ? `加载失败: ${live2dErr}`
                  : '在设置 → 主动行为 (待挪) 或 窗口 中填 panel.live2dModelPath'}
              </div>
              <div style={{ fontSize: 11, marginTop: 10, opacity: 0.55 }}>
                .model3.json 暂未集成 Web SDK; 现支持 png/jpg/gif/webp
              </div>
            </div>
          )}
        </div>

        <div className="panel-persona-switcher">
          <div className="panel-side-title">当前人设</div>
          {personas.map((p) => (
            <button
              key={p.id}
              className={`panel-persona-btn ${
                cfg.activePersonaId === p.id ? 'active' : ''
              }`}
              onClick={() => switchPersona(p.id)}
            >
              {p.display_name}
            </button>
          ))}
        </div>

        <div className="panel-side-actions">
          <button onClick={() => window.api.openSettings()}>设置</button>
          <button onClick={clearHistory}>清空视图</button>
          <button onClick={() => window.api.closePanel()}>关闭面板</button>
        </div>
      </aside>

      <main className="panel-main">
        <div className="panel-history" ref={scrollRef}>
          {rows.length === 0 && (
            <div className="muted" style={{ textAlign: 'center', padding: 32 }}>
              还没有对话. 在下方输入框开始吧.
            </div>
          )}
          {rows.map((r) => (
            <div key={r.id} className={`panel-row panel-row-${r.role}`}>
              <div className="panel-row-meta">
                {r.role === 'user' ? '我' : '夜梦'} ·{' '}
                {new Date(r.ts).toLocaleString()}
                {r.persona_id ? ` · ${r.persona_id}` : ''}
              </div>
              <div className="panel-row-text">{r.content}</div>
            </div>
          ))}
        </div>
        <div className="panel-input">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="说点什么 (Ctrl+Enter 发送)…"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void send();
              }
            }}
            disabled={pending}
            rows={3}
          />
          <button
            className="primary"
            onClick={() => void send()}
            disabled={pending || !input.trim()}
          >
            {pending ? '…' : '发送'}
          </button>
        </div>
      </main>
    </div>
  );
}
