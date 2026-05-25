import { useEffect, useState } from 'react';
import type {
  AppConfig,
  ConversationSummaryRow,
  EpisodeRow,
  FactRow,
  MemoryJobRow,
  MemorySourceRow,
  MemoryStats,
  RecallPolicy,
  TaskMemoryStatus,
  TaskRow
} from '../../../../shared/types';

type MemTab = 'overview' | 'longterm' | 'archive' | 'tasks' | 'debug' | 'jobs';
type SourceTarget = { type: 'fact' | 'conversation_summary'; id: number; title: string };
type MonologueEntry = Awaited<ReturnType<typeof window.api.innerMonologueList>>[number];

const TAB_LABELS: Record<MemTab, string> = {
  overview: '总览',
  longterm: '长期记忆',
  archive: '历史存档',
  tasks: '任务记录',
  debug: '内心独白日志',
  jobs: '后台整理'
};

const STATUS_LABELS: Record<TaskMemoryStatus, string> = {
  routine: '普通流水',
  candidate: '候选记忆',
  promoted: '长期记忆',
  unimportant: '不重要',
  disabled: '禁用'
};

const POLICY_LABELS: Record<RecallPolicy, string> = {
  always: '总是召回',
  on_topic: '相关时召回',
  manual_only: '仅手动查看',
  never: '永不召回'
};

export default function MemorySection() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [tab, setTab] = useState<MemTab>('overview');
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [summaries, setSummaries] = useState<ConversationSummaryRow[]>([]);
  const [jobs, setJobs] = useState<MemoryJobRow[]>([]);
  const [monologues, setMonologues] = useState<MonologueEntry[]>([]);
  const [graphStats, setGraphStats] = useState<{ ok: boolean; nodes?: number; relationships?: number; message?: string } | null>(null);
  const [graphMessage, setGraphMessage] = useState('');
  const [factForm, setFactForm] = useState({ predicate: '', subject: 'user', object: '' });
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sourceTarget, setSourceTarget] = useState<SourceTarget | null>(null);
  const [sources, setSources] = useState<MemorySourceRow[]>([]);

  const refresh = async () => {
    const [nextCfg, s] = await Promise.all([window.api.getConfig(), window.api.memStats()]);
    setCfg(nextCfg);
    setStats(s);
    if (tab === 'longterm') {
      const [nextFacts, nextSummaries] = await Promise.all([
        window.api.memListFacts(showAll ? undefined : 'active', 200),
        window.api.memListSummaries(100)
      ]);
      setFacts(nextFacts);
      setSummaries(nextSummaries);
    } else if (tab === 'archive') {
      setEpisodes(await window.api.memRecentEpisodes(60));
    } else if (tab === 'tasks') {
      setTasks(await window.api.memListTasks(80));
    } else if (tab === 'debug') {
      setMonologues(await window.api.innerMonologueList(80));
    } else if (tab === 'jobs') {
      setJobs(await window.api.memListJobs(undefined, 80));
    } else {
      setGraphStats(await window.api.memGraphStats());
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
      setEpisodes(await window.api.memRecentEpisodes(60));
      return;
    }
    setEpisodes(await window.api.memSearchEpisodes(q, 30));
  };

  const saveMemoryConfig = async () => {
    if (!cfg) return;
    const next = await window.api.setConfig({ memory: cfg.memory });
    setCfg(next);
    refresh();
  };

  const testGraph = async () => {
    const result = await window.api.memGraphTestConnection();
    setGraphMessage(result.message);
    setGraphStats(await window.api.memGraphStats());
  };

  const openSources = async (target: SourceTarget) => {
    setSourceTarget(target);
    setSources(await window.api.memListSources(target.type, target.id));
  };

  const updateTask = async (id: number, memory_status: TaskMemoryStatus, recall_policy: RecallPolicy) => {
    await window.api.memUpdateTaskMemoryState(id, { memory_status, recall_policy });
    refresh();
  };

  const promoteTask = async (task: TaskRow) => {
    await window.api.memPromoteTaskToMemory(task.id, {
      title: `Claude Code 任务 #${task.id}`,
      summary: task.summary ?? '',
      recall_policy: 'on_topic'
    });
    refresh();
  };

  const refreshMonologues = async () => {
    setMonologues(await window.api.innerMonologueList(80));
  };

  const clearMonologues = async () => {
    if (!confirm('清空内心独白日志? 这不会删除长期事实、摘要、任务记录或对话历史。')) return;
    await window.api.innerMonologueClear();
    refreshMonologues();
  };

  return (
    <div className="section">
      <h2>记忆系统</h2>
      <p className="muted">
        长期记忆会影响夜梦未来的理解和回应；历史存档只是证据层；任务记录默认只是工作流水；内心独白日志只用于观察角色内思考，不参与长期记忆、整理或召回。
      </p>
      {stats && (
        <p className="muted" style={{ fontSize: 12 }}>
          DB: {stats.dbPath} ｜ Episode {stats.episodes} ｜ Summary {stats.summaries} ｜ Facts{' '}
          {stats.activeFacts}/{stats.facts} ｜ Tasks {stats.tasks} ｜ Jobs pending/failed{' '}
          {stats.pendingMemoryJobs}/{stats.failedMemoryJobs}
        </p>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {(Object.keys(TAB_LABELS) as MemTab[]).map((key) => (
          <button key={key} className={tab === key ? 'primary' : ''} onClick={() => setTab(key)}>
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>

      {tab === 'overview' && cfg && (
        <div>
          <div className="memory-concept-grid">
            <div className="memory-concept-card"><strong>长期记忆</strong><span>facts、重要摘要和提升后的任务记忆，会影响未来对话。</span></div>
            <div className="memory-concept-card"><strong>历史存档</strong><span>原始 episode 是证据层，可检索，但不等于她主动记住。</span></div>
            <div className="memory-concept-card"><strong>任务记录</strong><span>Claude Code 完成记录默认是流水，只有候选或提升后才召回。</span></div>
            <div className="memory-concept-card"><strong>内心独白日志</strong><span>角色内思考和调试观察，不进入 SQLite 语义记忆和图谱。</span></div>
          </div>
          <div className="form-card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Neo4j 图谱记忆</h3>
            <label className="checkbox-row">
              <input type="checkbox" checked={cfg.memory.digestionEnabled} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, digestionEnabled: e.target.checked } })} />
              启用后台记忆整理
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={cfg.memory.graphEnabled} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, graphEnabled: e.target.checked } })} />
              启用 Neo4j
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={cfg.memory.graphWriteEnabled} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, graphWriteEnabled: e.target.checked } })} />
              写入图谱
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={cfg.memory.graphRecallEnabled} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, graphRecallEnabled: e.target.checked } })} />
              聊天时图谱召回
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={cfg.memory.embeddingEnabled} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, embeddingEnabled: e.target.checked } })} />
              启用 Embedding 向量索引
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={cfg.memory.vectorRecallEnabled} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, vectorRecallEnabled: e.target.checked } })} />
              聊天时向量召回
            </label>
            <label>
              Embedding Provider
              <select value={cfg.memory.embeddingProviderId ?? ''} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, embeddingProviderId: e.target.value || undefined } })}>
                <option value="">使用当前激活 Provider</option>
                {cfg.providers.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
              </select>
            </label>
            <label>
              Embedding Model
              <input value={cfg.memory.embeddingModel} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, embeddingModel: e.target.value } })} placeholder="例如 text-embedding-3-small / text-embedding-004" />
            </label>
            <label>
              Vector Recall Limit
              <input type="number" min={1} max={20} value={cfg.memory.vectorRecallLimit} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, vectorRecallLimit: Number(e.target.value) } })} />
            </label>
            <label>
              Vector Min Score
              <input type="number" min={0} max={1} step={0.01} value={cfg.memory.vectorMinScore} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, vectorMinScore: Number(e.target.value) } })} />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={cfg.memory.rerankEnabled} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, rerankEnabled: e.target.checked } })} />
              启用 Reranker 精排
            </label>
            <label>
              Reranker URL
              <input value={cfg.memory.rerankUrl} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, rerankUrl: e.target.value } })} placeholder="例如 http://127.0.0.1:8000/v1/rerank" />
            </label>
            <label>
              Reranker API Key (可选)
              <input type="password" value={cfg.memory.rerankApiKey} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, rerankApiKey: e.target.value } })} />
            </label>
            <label>
              Reranker Model
              <input value={cfg.memory.rerankModel} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, rerankModel: e.target.value } })} placeholder="例如 bge-reranker-v2-m3 / jina-reranker-v2-base-multilingual" />
            </label>
            <label>
              Rerank Top K
              <input type="number" min={1} max={20} value={cfg.memory.rerankTopK} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, rerankTopK: Number(e.target.value) } })} />
            </label>
            <label>
              Rerank Min Score
              <input type="number" min={0} max={1} step={0.01} value={cfg.memory.rerankMinScore} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, rerankMinScore: Number(e.target.value) } })} />
            </label>
            <label>
              Neo4j URI
              <input value={cfg.memory.neo4jUri} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, neo4jUri: e.target.value } })} />
            </label>
            <label>
              User
              <input value={cfg.memory.neo4jUser} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, neo4jUser: e.target.value } })} />
            </label>
            <label>
              Password
              <input type="password" value={cfg.memory.neo4jPassword} onChange={(e) => setCfg({ ...cfg, memory: { ...cfg.memory, neo4jPassword: e.target.value } })} />
            </label>
            <div className="form-actions">
              <button className="primary" onClick={saveMemoryConfig}>保存配置</button>
              <button onClick={testGraph}>测试 Neo4j 连接</button>
              <button onClick={async () => { await window.api.memKickDigestion(); refresh(); }}>整理 pending job</button>
              <button onClick={async () => { await window.api.memBackfillEmbeddings(); refresh(); }}>补齐向量索引</button>
            </div>
            {graphMessage && <p className="muted">{graphMessage}</p>}
          </div>
          <p className="muted">
            Neo4j: {graphStats?.ok ? `connected · nodes ${graphStats.nodes} · relations ${graphStats.relationships}` : graphStats?.message ?? '未测试'}
          </p>
          {stats && <p className="muted">Graph sync: synced {stats.graphSynced} ｜ failed {stats.graphFailed}</p>}
        </div>
      )}

      {tab === 'longterm' && (
        <div>
          <div className="form-card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>新增事实 (predicate-keyed)</h3>
            <p className="muted">这些 active facts 会作为长期语义事实影响未来对话；撤回后保留记录但不再主动使用。</p>
            <label>Predicate (键)<input value={factForm.predicate} onChange={(e) => setFactForm({ ...factForm, predicate: e.target.value })} placeholder="例如: preferred_address / current_project" /></label>
            <label>Subject (主体, 默认 user)<input value={factForm.subject} onChange={(e) => setFactForm({ ...factForm, subject: e.target.value })} /></label>
            <label>Object (值)<input value={factForm.object} onChange={(e) => setFactForm({ ...factForm, object: e.target.value })} /></label>
            <div className="form-actions"><button className="primary" onClick={addFact}>添加</button></div>
          </div>
          <label className="checkbox-row"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />显示全部事实状态</label>
          <h3>语义事实</h3>
          <table className="cap-table"><thead><tr><th>ID</th><th>Predicate</th><th>Subject</th><th>Object</th><th>类型</th><th>状态</th><th>置信</th><th>操作</th></tr></thead><tbody>
            {facts.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>暂无</td></tr>}
            {facts.map((f) => <tr key={f.id}><td>{f.id}</td><td>{f.predicate}</td><td>{f.subject}</td><td>{f.object}</td><td><span className="memory-policy-badge">{f.cardinality ?? 'single'}</span></td><td><span className="memory-policy-badge">{f.status}</span></td><td>{f.confidence.toFixed(2)}</td><td><button className="mini" onClick={() => openSources({ type: 'fact', id: f.id, title: `fact #${f.id}` })}>来源</button> {f.status === 'active' ? <button className="mini" onClick={() => retract(f.id)}>retract</button> : <button className="mini" onClick={() => reactivate(f.id)}>reactivate</button>} <button className="mini danger" onClick={() => purge(f.id)}>×</button></td></tr>)}
          </tbody></table>

          <h3>对话 / 任务摘要</h3>
          <table className="cap-table"><thead><tr><th>ID</th><th>时间</th><th>类型</th><th>重要性</th><th>标题</th><th>摘要</th><th>来源</th></tr></thead><tbody>
            {summaries.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>暂无</td></tr>}
            {summaries.map((s) => <tr key={s.id}><td>{s.id}</td><td>{new Date(s.ts).toLocaleString()}</td><td><span className="memory-policy-badge">{s.kind === 'task_memory' ? '任务提升记忆' : s.kind}</span></td><td>{s.importance.toFixed(2)}</td><td>{s.title}</td><td>{s.summary.slice(0, 260)}</td><td><button className="mini" onClick={() => openSources({ type: 'conversation_summary', id: s.id, title: `summary #${s.id}` })}>来源</button></td></tr>)}
          </tbody></table>
        </div>
      )}

      {tab === 'archive' && (
        <div>
          <p className="memory-debug-note">这里是对话历史证据层。它可以被搜索和作为来源引用，但不等于夜梦主动记住的长期事实。</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}><input style={{ flex: 1 }} placeholder="FTS5 搜索; 留空显示最近 60 条" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }} /><button onClick={doSearch}>搜索</button></div>
          <div className="ep-list">{episodes.length === 0 && <div className="muted" style={{ textAlign: 'center', padding: 20 }}>暂无</div>}{episodes.map((e) => <div key={e.id} className={`ep-row ep-${e.role}`}><div className="ep-meta"><span className="muted">#{e.id}</span> · {new Date(e.ts).toLocaleString()} · {e.role} · {e.persona_id}</div><div className="ep-content">{e.content.slice(0, 600)}</div></div>)}</div>
        </div>
      )}

      {tab === 'tasks' && (
        <div>
          <p className="memory-debug-note">Claude Code 任务会保存在这里作为工作存档。普通任务流水默认不会进入长期记忆，也不会自动塞进聊天 prompt。只有候选或提升后的任务才可能在相关话题中召回。</p>
          <table className="cap-table"><thead><tr><th>ID</th><th>时间</th><th>Session</th><th>状态</th><th>召回</th><th>摘要</th><th>操作</th></tr></thead><tbody>
            {tasks.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>暂无</td></tr>}
            {tasks.map((t) => <tr key={t.id}><td>{t.id}</td><td>{new Date(t.ts).toLocaleString()}</td><td className="muted" style={{ fontSize: 11 }}>{(t.session_id ?? '').slice(0, 12)}</td><td><span className="memory-policy-badge">{STATUS_LABELS[t.memory_status] ?? t.memory_status}</span></td><td><span className="memory-policy-badge">{POLICY_LABELS[t.recall_policy] ?? t.recall_policy}</span></td><td>{(t.summary ?? '').slice(0, 220)}</td><td><button className="mini" disabled={t.memory_status === 'promoted'} onClick={() => promoteTask(t)}>提升</button> <button className="mini" onClick={() => updateTask(t.id, 'candidate', 'on_topic')}>候选</button> <button className="mini" onClick={() => updateTask(t.id, 'routine', 'manual_only')}>流水</button> <button className="mini danger" onClick={() => updateTask(t.id, 'unimportant', 'never')}>不重要</button></td></tr>)}
          </tbody></table>
        </div>
      )}

      {tab === 'debug' && (
        <div>
          <p className="memory-debug-note">内心独白日志用于观察夜梦回复前的角色内思考和 provider 行为。它不进入 episodes、facts、conversation_summaries、graph，也不参与长期召回。清空这里不会删除长期事实、对话摘要、任务记录或历史存档。</p>
          <div className="form-actions" style={{ marginBottom: 12 }}>
            <button onClick={refreshMonologues}>刷新</button>
            <button onClick={() => window.api.innerMonologueOpenLogFile()}>打开 JSONL</button>
            <button className="danger" onClick={clearMonologues}>清空日志</button>
          </div>
          <div className="ep-list">{monologues.length === 0 && <div className="muted" style={{ textAlign: 'center', padding: 20 }}>暂无</div>}{monologues.map((m) => <div key={`${m.ts}-${m.source}-${m.model}`} className="ep-row"><div className="ep-meta">{new Date(m.ts).toLocaleString()} · {m.source} · {m.persona} · {m.model}</div><div className="ep-content"><strong>独白：</strong>{m.monologue.slice(0, 420)}{m.dialog && <><br /><strong>对白：</strong>{m.dialog.slice(0, 220)}</>}</div></div>)}</div>
        </div>
      )}

      {tab === 'jobs' && (
        <div>
          <p className="memory-debug-note">后台整理任务用于把对话证据提炼为长期记忆。失败的 job 可以重试。</p>
          <table className="cap-table"><thead><tr><th>ID</th><th>类型</th><th>状态</th><th>尝试</th><th>创建</th><th>开始</th><th>下次</th><th>错误</th><th></th></tr></thead><tbody>
            {jobs.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center' }}>暂无</td></tr>}
            {jobs.map((j) => <tr key={j.id}><td>{j.id}</td><td>{j.type}</td><td>{j.status}</td><td>{j.attempts}/{j.max_attempts ?? 3}</td><td>{new Date(j.created_at).toLocaleString()}</td><td>{j.started_at ? new Date(j.started_at).toLocaleString() : '-'}</td><td>{j.next_run_at ? new Date(j.next_run_at).toLocaleString() : '-'}</td><td>{(j.error ?? '').slice(0, 220)}</td><td>{j.status === 'failed' && <button className="mini" onClick={async () => { await window.api.memRetryJob(j.id); refresh(); }}>retry</button>}</td></tr>)}
          </tbody></table>
        </div>
      )}

      {sourceTarget && (
        <div className="modal-mask" onClick={() => setSourceTarget(null)}>
          <div className="modal memory-source-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <h3>来源 · {sourceTarget.title}</h3>
              <button className="mini" onClick={() => setSourceTarget(null)}>关闭</button>
            </div>
            <div className="memory-source-list">
              {sources.length === 0 && <p className="muted">暂无来源记录。旧数据或手动导入的数据可能只有基础字段，没有 memory_sources。</p>}
              {sources.map((s) => <div key={s.id} className="memory-source-row"><div className="ep-meta">#{s.id} · {s.source_type} #{s.source_id} · {new Date(s.created_at).toLocaleString()}</div><div>{s.excerpt || '(无 excerpt)'}</div></div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
