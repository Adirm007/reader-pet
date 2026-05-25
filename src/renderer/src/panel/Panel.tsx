import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig, EpisodeRow, PersonaMeta } from '../../../shared/types';

interface ChatRow {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  persona_id?: string;
}

interface MonologueEntry {
  ts: number;
  source: 'chat' | 'chatter' | 'letter' | 'task-report';
  persona: string;
  provider: string;
  model: string;
  trigger?: string;
  monologue: string;
  dialog: string;
  outputTokens?: number;
}

const SOURCE_LABELS: Record<MonologueEntry['source'], string> = {
  chat: '对话',
  chatter: '主动搭话',
  letter: '每日信',
  'task-report': '任务汇报'
};

export default function Panel() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [personas, setPersonas] = useState<PersonaMeta[]>([]);
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [live2dUrl, setLive2dUrl] = useState<string | null>(null);
  const [live2dErr, setLive2dErr] = useState<string | null>(null);
  const [monoOpen, setMonoOpen] = useState(false);
  const [monoEntries, setMonoEntries] = useState<MonologueEntry[]>([]);
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

  // 立绘加载 — 路径为空时让 main 端 fallback 到内置占位图
  useEffect(() => {
    setLive2dUrl(null);
    setLive2dErr(null);
    const p = cfg?.panel?.live2dModelPath ?? '';
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

  const openMonologues = useCallback(async () => {
    const list = await window.api.innerMonologueList(100);
    setMonoEntries(list);
    setMonoOpen(true);
  }, []);

  const refreshMonologues = useCallback(async () => {
    const list = await window.api.innerMonologueList(100);
    setMonoEntries(list);
  }, []);

  const clearMonologues = useCallback(async () => {
    if (!confirm('清空所有内心独白记录 (含磁盘 jsonl)? 这不会删除长期事实、摘要和对话历史.')) return;
    await window.api.innerMonologueClear();
    setMonoEntries([]);
  }, []);

  if (!cfg) return <div style={{ padding: 24 }}>加载中…</div>;

  return (
    <div className="panel-root">
      <aside className="panel-side">
        <div className="panel-portrait">
          {live2dUrl ? (
            <img src={live2dUrl} alt="立绘" />
          ) : (
            <div className="panel-portrait-empty">
              <div className="portrait-empty-title">立绘加载失败</div>
              <div className="portrait-empty-reason">
                {live2dErr ?? '未知原因'}
              </div>
              <div className="portrait-empty-hint">
                可在 设置 → 面板 中指定本地立绘路径覆盖默认
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
          <button className="panel-mono-toggle" onClick={openMonologues}>
            翻阅夜梦的思考
          </button>
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

      {monoOpen && (
        <div className="panel-mono-overlay" onClick={() => setMonoOpen(false)}>
          <div className="panel-mono-book" onClick={(e) => e.stopPropagation()}>
            <div className="panel-mono-head">
              <div>
                <h2>夜梦 · 内心独白日志</h2>
                <p className="panel-mono-note">这些记录只用于观察角色内思考和调试模型行为，不参与长期记忆、后台整理或召回。清空它不会删除事实、摘要和对话历史。</p>
              </div>
              <div className="panel-mono-head-actions">
                <button onClick={() => void refreshMonologues()}>刷新</button>
                <button onClick={() => void window.api.innerMonologueOpenLogFile()}>
                  打开 jsonl
                </button>
                <button onClick={() => void clearMonologues()}>清空</button>
                <button onClick={() => setMonoOpen(false)}>合上</button>
              </div>
            </div>
            <div className="panel-mono-body">
              {monoEntries.length === 0 ? (
                <div className="panel-mono-empty">
                  这里还没有任何思考记录. 与夜梦说几句话试试.
                </div>
              ) : (
                monoEntries
                  .slice()
                  .reverse()
                  .map((m) => (
                    <div className="panel-mono-entry" key={m.ts + m.source}>
                      <div className="panel-mono-entry-head">
                        <span className="panel-mono-entry-source">
                          {SOURCE_LABELS[m.source]}
                        </span>
                        <span>{new Date(m.ts).toLocaleString()}</span>
                        <span>
                          {m.persona} · {m.model || m.provider}
                        </span>
                        {typeof m.outputTokens === 'number' && (
                          <span>{m.outputTokens} tokens</span>
                        )}
                      </div>
                      {m.trigger && (
                        <div className="panel-mono-entry-trigger">{m.trigger}</div>
                      )}
                      <div className="panel-mono-entry-text">{m.monologue}</div>
                      {m.dialog && (
                        <div className="panel-mono-entry-dialog">{m.dialog}</div>
                      )}
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
