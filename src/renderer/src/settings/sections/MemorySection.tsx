import { useEffect, useState } from 'react';
import type { EpisodeRow, FactRow, MemoryStats, TaskRow } from '../../../../shared/types';

type MemTab = 'facts' | 'episodes' | 'tasks';

export default function MemorySection() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [tab, setTab] = useState<MemTab>('facts');
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [factForm, setFactForm] = useState({ predicate: '', subject: 'user', object: '' });
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const refresh = async () => {
    const s = await window.api.memStats();
    setStats(s);
    if (tab === 'facts') {
      const list = await window.api.memListFacts(showAll ? undefined : 'active', 200);
      setFacts(list);
    } else if (tab === 'episodes') {
      const list = await window.api.memRecentEpisodes(60);
      setEpisodes(list);
    } else {
      const list = await window.api.memListTasks(60);
      setTasks(list);
    }
  };

  useEffect(() => {
    refresh();
  }, [tab, showAll]);

  const addFact = async () => {
    if (!factForm.predicate.trim() || !factForm.object.trim()) return;
    await window.api.memUpsertFact(factForm);
    setFactForm({ predicate: '', subject: 'user', object: '' });
    refresh();
  };

  const retract = async (id: number) => {
    await window.api.memSetFactStatus(id, 'retracted');
    refresh();
  };
  const reactivate = async (id: number) => {
    await window.api.memSetFactStatus(id, 'active');
    refresh();
  };
  const purge = async (id: number) => {
    if (!confirm('永久删除该事实记录?')) return;
    await window.api.memDeleteFact(id);
    refresh();
  };

  const doSearch = async () => {
    const q = search.trim();
    if (!q) {
      const list = await window.api.memRecentEpisodes(60);
      setEpisodes(list);
      return;
    }
    const list = await window.api.memSearchEpisodes(q, 30);
    setEpisodes(list);
  };

  return (
    <div className="section">
      <h2>记忆系统</h2>
      <p className="muted">
        Layer 1 Profile 在用户 Profile; Layer 2 Recent 在内存进程; Layer 3 Episode + Layer 4 Facts +
        Layer 5 Task 在本地 SQLite.
      </p>
      {stats && (
        <p className="muted" style={{ fontSize: 12 }}>
          DB: {stats.dbPath} ｜ Episode {stats.episodes} ｜ Facts {stats.activeFacts}/{stats.facts}{' '}
          (active/total) ｜ Tasks {stats.tasks}
        </p>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button className={tab === 'facts' ? 'primary' : ''} onClick={() => setTab('facts')}>
          语义事实
        </button>
        <button className={tab === 'episodes' ? 'primary' : ''} onClick={() => setTab('episodes')}>
          对话历史
        </button>
        <button className={tab === 'tasks' ? 'primary' : ''} onClick={() => setTab('tasks')}>
          Claude Code 任务
        </button>
      </div>

      {tab === 'facts' && (
        <div>
          <div className="form-card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>新增事实 (predicate-keyed)</h3>
            <label>
              Predicate (键)
              <input
                value={factForm.predicate}
                onChange={(e) => setFactForm({ ...factForm, predicate: e.target.value })}
                placeholder="例如: preferred_address / current_project / favorite_color"
              />
            </label>
            <label>
              Subject (主体, 默认 user)
              <input
                value={factForm.subject}
                onChange={(e) => setFactForm({ ...factForm, subject: e.target.value })}
              />
            </label>
            <label>
              Object (值)
              <input
                value={factForm.object}
                onChange={(e) => setFactForm({ ...factForm, object: e.target.value })}
                placeholder="作家先生 / 我在写一篇推理短篇 / 紫色"
              />
            </label>
            <div className="form-actions">
              <button className="primary" onClick={addFact}>
                添加 (同 predicate+subject 自动 supersede)
              </button>
            </div>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            显示全部 (含 superseded / retracted)
          </label>
          <table className="cap-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Predicate</th>
                <th>Subject</th>
                <th>Object</th>
                <th>状态</th>
                <th>置信</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {facts.length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>暂无</td></tr>
              )}
              {facts.map((f) => (
                <tr key={f.id}>
                  <td>{f.id}</td>
                  <td>{f.predicate}</td>
                  <td>{f.subject}</td>
                  <td>{f.object}</td>
                  <td>{f.status}</td>
                  <td>{f.confidence.toFixed(2)}</td>
                  <td>
                    {f.status === 'active' && (
                      <button className="mini" onClick={() => retract(f.id)}>retract</button>
                    )}
                    {f.status !== 'active' && (
                      <button className="mini" onClick={() => reactivate(f.id)}>reactivate</button>
                    )}{' '}
                    <button className="mini danger" onClick={() => purge(f.id)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'episodes' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              style={{ flex: 1 }}
              placeholder="FTS5 搜索 (空格分隔关键词); 留空显示最近 60 条"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSearch();
              }}
            />
            <button onClick={doSearch}>搜索</button>
          </div>
          <div className="ep-list">
            {episodes.length === 0 && (
              <div className="muted" style={{ textAlign: 'center', padding: 20 }}>暂无</div>
            )}
            {episodes.map((e) => (
              <div key={e.id} className={`ep-row ep-${e.role}`}>
                <div className="ep-meta">
                  <span className="muted">#{e.id}</span> · {new Date(e.ts).toLocaleString()} · {e.role}{' '}
                  · {e.persona_id}
                </div>
                <div className="ep-content">{e.content.slice(0, 600)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'tasks' && (
        <table className="cap-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>时间</th>
              <th>Session</th>
              <th>摘要</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>暂无</td></tr>
            )}
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.id}</td>
                <td>{new Date(t.ts).toLocaleString()}</td>
                <td className="muted" style={{ fontSize: 11 }}>{(t.session_id ?? '').slice(0, 12)}</td>
                <td>{(t.summary ?? '').slice(0, 200)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
