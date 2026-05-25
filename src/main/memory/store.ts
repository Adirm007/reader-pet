// 五层记忆系统 — SQLite + FTS5 实现
// Layer 1 Profile: 已经在 AppConfig.profile, 不入此库
// Layer 2 Recent Window: 进程内 ring buffer (chat.ts), 不入此库
// Layer 3 Episode Log: 全部对话历史 (本表)
// Layer 4 Semantic Facts: predicate-keyed 结构化事实 (本表)
// Layer 5 Task Log: Claude Code 完成记录 (本表)
//
// 设计理念: 默认不查 4 / 不查 3, 避免无谓 token. 用户主动呼出"召回"或事实管理时才查.
// FTS5 仅在 episode 上启用 (供"我之前是不是说过 XXX"类召回).
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import type {
  ConversationSummaryRow,
  EmbeddableMemoryType,
  EpisodeRow,
  FactCardinality,
  FactRow,
  FactStatus,
  GraphSyncStateRow,
  MemoryEmbeddingRow,
  MemoryJobRow,
  MemoryJobStatus,
  MemoryScope,
  MemorySourceRow,
  RecallPolicy,
  TaskMemoryStatus,
  TaskRow,
  MemoryStats
} from '../../shared/types';

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  const dir = app.getPath('userData');
  const dbPath = join(dir, 'reader-pet-memory.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  initSchema(db);
  _db = db;
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      persona_id TEXT NOT NULL,
      session_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_episodes_ts ON episodes(ts);
    CREATE INDEX IF NOT EXISTS idx_episodes_persona ON episodes(persona_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
      content,
      content='episodes',
      content_rowid='id',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
      INSERT INTO episodes_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS episodes_ad AFTER DELETE ON episodes BEGIN
      INSERT INTO episodes_fts(episodes_fts, rowid, content) VALUES('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS episodes_au AFTER UPDATE ON episodes BEGIN
      INSERT INTO episodes_fts(episodes_fts, rowid, content) VALUES('delete', old.id, old.content);
      INSERT INTO episodes_fts(rowid, content) VALUES (new.id, new.content);
    END;

    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      predicate TEXT NOT NULL,
      subject TEXT NOT NULL,
      object TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.8,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      superseded_by INTEGER,
      source_episode_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_facts_pred ON facts(predicate, subject, status);

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      session_id TEXT,
      transcript_path TEXT,
      summary TEXT,
      raw_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_ts ON tasks(ts);

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      episode_start_id INTEGER,
      episode_end_id INTEGER,
      persona_id TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      kind TEXT NOT NULL,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      entities_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_summaries_range_kind
      ON conversation_summaries(episode_start_id, episode_end_id, kind);
    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_ts ON conversation_summaries(ts);

    CREATE TABLE IF NOT EXISTS memory_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      dedupe_key TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_jobs_dedupe
      ON memory_jobs(dedupe_key) WHERE dedupe_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_memory_jobs_status ON memory_jobs(status, created_at);

    CREATE TABLE IF NOT EXISTS memory_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_type TEXT NOT NULL,
      memory_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      excerpt TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_sources_memory ON memory_sources(memory_type, memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_sources_source ON memory_sources(source_type, source_id);

    CREATE TABLE IF NOT EXISTS graph_sync_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      neo4j_element_id TEXT,
      synced_at INTEGER,
      status TEXT NOT NULL,
      error TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_sync_state_source
      ON graph_sync_state(source_type, source_id);

    CREATE TABLE IF NOT EXISTS memory_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_type TEXT NOT NULL,
      memory_id INTEGER NOT NULL,
      provider_id TEXT,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      text_hash TEXT NOT NULL,
      source_text TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_embeddings_unique
      ON memory_embeddings(memory_type, memory_id, model);
    CREATE INDEX IF NOT EXISTS idx_memory_embeddings_lookup
      ON memory_embeddings(memory_type, model);
  `);

  ensureColumn(db, 'episodes', 'scope', `TEXT NOT NULL DEFAULT 'persona'`);
  ensureColumn(db, 'episodes', 'project_id', 'TEXT');
  ensureColumn(db, 'facts', 'cardinality', `TEXT NOT NULL DEFAULT 'single'`);
  ensureColumn(db, 'facts', 'scope', `TEXT NOT NULL DEFAULT 'global'`);
  ensureColumn(db, 'facts', 'persona_id', 'TEXT');
  ensureColumn(db, 'facts', 'project_id', 'TEXT');
  ensureColumn(db, 'facts', 'recall_policy', `TEXT NOT NULL DEFAULT 'on_topic'`);
  ensureColumn(db, 'facts', 'updated_at', 'INTEGER');
  ensureColumn(db, 'facts', 'last_used_at', 'INTEGER');
  ensureColumn(db, 'facts', 'use_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'tasks', 'memory_status', `TEXT NOT NULL DEFAULT 'routine'`);
  ensureColumn(db, 'tasks', 'recall_policy', `TEXT NOT NULL DEFAULT 'manual_only'`);
  ensureColumn(db, 'tasks', 'promoted_summary_id', 'INTEGER');
  ensureColumn(db, 'tasks', 'promoted_at', 'INTEGER');
  ensureColumn(db, 'tasks', 'user_note', 'TEXT');
  ensureColumn(db, 'conversation_summaries', 'status', `TEXT NOT NULL DEFAULT 'active'`);
  ensureColumn(db, 'conversation_summaries', 'recall_policy', `TEXT NOT NULL DEFAULT 'on_topic'`);
  ensureColumn(db, 'conversation_summaries', 'scope', `TEXT NOT NULL DEFAULT 'persona'`);
  ensureColumn(db, 'conversation_summaries', 'project_id', 'TEXT');
  ensureColumn(db, 'conversation_summaries', 'updated_at', 'INTEGER');
  ensureColumn(db, 'conversation_summaries', 'last_used_at', 'INTEGER');
  ensureColumn(db, 'conversation_summaries', 'use_count', 'INTEGER NOT NULL DEFAULT 0');
  backfillMemoryScopes(db);
  ensureColumn(db, 'memory_jobs', 'next_run_at', 'INTEGER');
  ensureColumn(db, 'memory_jobs', 'max_attempts', 'INTEGER NOT NULL DEFAULT 3');
  ensureColumn(db, 'memory_jobs', 'last_heartbeat_at', 'INTEGER');
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string) {
  const safeTable = requireIdentifier(table);
  const safeColumn = requireIdentifier(column);
  const cols = db.prepare(`PRAGMA table_info(${safeTable})`).all() as Array<{ name: string }>;
  if (!cols.some((col) => col.name === safeColumn)) {
    db.exec(`ALTER TABLE ${safeTable} ADD COLUMN ${safeColumn} ${definition}`);
  }
}

function backfillMemoryScopes(db: Database.Database) {
  db.exec(`
    UPDATE episodes SET scope = 'persona' WHERE (scope IS NULL OR scope = '') AND persona_id IS NOT NULL AND persona_id != '';
    UPDATE episodes SET scope = 'global' WHERE scope IS NULL OR scope = '';
    UPDATE conversation_summaries SET scope = 'persona' WHERE (scope IS NULL OR scope = '') AND persona_id IS NOT NULL AND persona_id != '';
    UPDATE conversation_summaries SET scope = 'global' WHERE scope IS NULL OR scope = '';
    UPDATE facts SET scope = 'global' WHERE scope IS NULL OR scope = '';
    UPDATE facts SET recall_policy = 'on_topic' WHERE recall_policy IS NULL OR recall_policy = '';
    UPDATE facts SET use_count = 0 WHERE use_count IS NULL;
    UPDATE conversation_summaries SET use_count = 0 WHERE use_count IS NULL;
  `);
}

function requireIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('invalid SQL identifier');
  return value;
}

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(limit as number)));
}

const SET_FACT_PREDICATES = new Set([
  'likes',
  'dislikes',
  'interests',
  'boundaries',
  'tools',
  'ongoing_projects',
  'writing_themes',
  'favorite_works',
  'favorite_characters',
  'allergies',
  'relationship_context'
]);

export function inferFactCardinality(predicate: string): FactCardinality {
  const normalized = String(predicate ?? '').trim().toLowerCase();
  if (SET_FACT_PREDICATES.has(normalized) || /(_list|_items|_tags)$/.test(normalized)) return 'set';
  return 'single';
}

function normalizeFactInput(row: {
  predicate: string;
  subject?: string;
  object: string;
  confidence?: number;
  source_episode_id?: number;
  cardinality?: FactCardinality;
  scope?: MemoryScope;
  persona_id?: string;
  project_id?: string;
  recall_policy?: RecallPolicy;
}) {
  const predicate = String(row.predicate ?? '').trim().toLowerCase();
  const subject = String(row.subject ?? 'user').trim() || 'user';
  const object = String(row.object ?? '').trim();
  if (!/^[a-z0-9_.-]{1,64}$/.test(predicate)) {
    throw new Error('predicate 必须是 1-64 位小写字母/数字/下划线/点/短横线');
  }
  if (subject.length > 80) throw new Error('subject 不能超过 80 字符');
  if (!object) throw new Error('object 不能为空');
  if (object.length > 1000) throw new Error('object 不能超过 1000 字符');
  const rawConfidence = row.confidence ?? 0.8;
  const confidence = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(1, Number(rawConfidence)))
    : 0.8;
  const cardinality = row.cardinality === 'set' ? 'set' : row.cardinality === 'single' ? 'single' : inferFactCardinality(predicate);
  const scope = normalizeMemoryScope(row);
  const recall_policy = requireRecallPolicy(row.recall_policy ?? 'on_topic');
  return {
    predicate,
    subject,
    object,
    confidence,
    cardinality,
    ...scope,
    recall_policy,
    source_episode_id: row.source_episode_id
  };
}

function buildFtsQuery(query: string): string {
  const terms = query
    .replace(/["'`]/g, ' ')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' ');
}

function toNullable<T extends Record<string, any>>(row: T): T {
  const copy: Record<string, any> = { ...row };
  for (const key of Object.keys(copy)) {
    if (copy[key] === null) copy[key] = undefined;
  }
  return copy as T;
}

function requireMemoryJobStatus(status: string): MemoryJobStatus {
  if (!['pending', 'running', 'done', 'failed'].includes(status)) {
    throw new Error('无效 memory job status');
  }
  return status as MemoryJobStatus;
}

function requireTaskMemoryStatus(status: string): TaskMemoryStatus {
  if (!['routine', 'candidate', 'promoted', 'unimportant', 'disabled'].includes(status)) {
    throw new Error('无效 task memory status');
  }
  return status as TaskMemoryStatus;
}

function requireRecallPolicy(policy: string): RecallPolicy {
  if (!['always', 'on_topic', 'manual_only', 'never'].includes(policy)) {
    throw new Error('无效 recall policy');
  }
  return policy as RecallPolicy;
}

function requireMemoryScope(scope: string): MemoryScope {
  if (!['global', 'persona', 'project'].includes(scope)) {
    throw new Error('无效 memory scope');
  }
  return scope as MemoryScope;
}

function normalizeMemoryScope(input?: {
  scope?: MemoryScope;
  persona_id?: string;
  project_id?: string;
}): { scope: MemoryScope; persona_id?: string; project_id?: string } {
  const scope = requireMemoryScope(input?.scope ?? 'global');
  const persona_id = input?.persona_id?.trim() || undefined;
  const project_id = input?.project_id?.trim() || undefined;
  return {
    scope,
    persona_id: scope === 'persona' ? persona_id : undefined,
    project_id: scope === 'project' ? project_id : undefined
  };
}

function taskExcerpt(task: TaskRow): string {
  const text = (task.summary?.trim() || task.raw_json || '').trim();
  return text.length > 800 ? `${text.slice(0, 800)}…` : text;
}

// ===== Episode =====
export function appendEpisode(row: Omit<EpisodeRow, 'id'>): number {
  const db = getDb();
  const scope = normalizeMemoryScope({
    scope: row.scope ?? 'persona',
    persona_id: row.persona_id,
    project_id: row.project_id
  });
  const stmt = db.prepare(
    `INSERT INTO episodes (ts, role, content, persona_id, session_id, scope, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const r = stmt.run(row.ts, row.role, row.content, row.persona_id, row.session_id ?? null, scope.scope, scope.project_id ?? null);
  return Number(r.lastInsertRowid);
}

export function getEpisodeById(id: number): EpisodeRow | undefined {
  const row = getDb().prepare(`SELECT * FROM episodes WHERE id = ?`).get(id) as EpisodeRow | undefined;
  return row ? toNullable(row) : undefined;
}

function visibleScopeSql(alias: string, opts?: { personaId?: string; projectId?: string }) {
  const clauses = [`${alias}.scope = 'global'`];
  const values: any[] = [];
  if (opts?.personaId) {
    clauses.push(`(${alias}.scope = 'persona' AND ${alias}.persona_id = ?)`);
    values.push(opts.personaId);
  }
  if (opts?.projectId) {
    clauses.push(`(${alias}.scope = 'project' AND ${alias}.project_id = ?)`);
    values.push(opts.projectId);
  }
  return { sql: `(${clauses.join(' OR ')})`, values };
}

export function searchEpisodes(query: string, limit = 10, opts?: { personaId?: string; projectId?: string }): EpisodeRow[] {
  const db = getDb();
  const safeLimit = clampLimit(limit, 10, 100);
  const q = buildFtsQuery(query.trim());
  if (!q) return [];
  const visible = visibleScopeSql('e', opts);
  try {
    return db
      .prepare(`
        SELECT e.* FROM episodes_fts f JOIN episodes e ON e.id = f.rowid
        WHERE episodes_fts MATCH ? AND ${visible.sql} ORDER BY rank LIMIT ?
      `)
      .all(q, ...visible.values, safeLimit)
      .map((row) => toNullable(row as EpisodeRow));
  } catch {
    return db
      .prepare(`SELECT e.* FROM episodes e WHERE e.content LIKE ? AND ${visible.sql} ORDER BY e.id DESC LIMIT ?`)
      .all(`%${query.trim()}%`, ...visible.values, safeLimit)
      .map((row) => toNullable(row as EpisodeRow));
  }
}

export function recentEpisodes(limit = 50, persona?: string): EpisodeRow[] {
  const db = getDb();
  const safeLimit = clampLimit(limit, 50, 500);
  if (persona) {
    return db
      .prepare(`SELECT * FROM episodes WHERE persona_id = ? ORDER BY id DESC LIMIT ?`)
      .all(persona, safeLimit) as EpisodeRow[];
  }
  return db
    .prepare(`SELECT * FROM episodes ORDER BY id DESC LIMIT ?`)
    .all(safeLimit) as EpisodeRow[];
}

function localDayBounds(localDay: string): { start: number; end: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDay)) throw new Error('localDay 必须是 YYYY-MM-DD');
  const start = new Date(`${localDay}T00:00:00`).getTime();
  const end = new Date(`${localDay}T23:59:59.999`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('无效 localDay');
  return { start, end };
}

export function getEpisodeBoundsForLocalDay(input: { personaId: string; localDay: string }): { episodeStartId: number; episodeEndId: number } | null {
  const { start, end } = localDayBounds(input.localDay);
  const row = getDb()
    .prepare(`SELECT MIN(id) AS episodeStartId, MAX(id) AS episodeEndId FROM episodes WHERE persona_id = ? AND ts >= ? AND ts <= ?`)
    .get(input.personaId, start, end) as { episodeStartId?: number; episodeEndId?: number } | undefined;
  if (!row?.episodeStartId || !row?.episodeEndId) return null;
  return { episodeStartId: row.episodeStartId, episodeEndId: row.episodeEndId };
}

export function listEpisodesInRange(input: { personaId: string; episodeStartId: number; episodeEndId: number }): EpisodeRow[] {
  return getDb()
    .prepare(`SELECT * FROM episodes WHERE persona_id = ? AND id BETWEEN ? AND ? ORDER BY id ASC`)
    .all(input.personaId, input.episodeStartId, input.episodeEndId)
    .map((row) => toNullable(row as EpisodeRow));
}

export function listDailyDigestCoverage(input: {
  personaId: string;
  episodeStartId: number;
  episodeEndId: number;
}): Array<{ episodeStartId: number; episodeEndId: number }> {
  return getDb()
    .prepare(
      `SELECT episode_start_id AS episodeStartId, episode_end_id AS episodeEndId
       FROM conversation_summaries
       WHERE kind = 'daily_digest'
         AND status = 'active'
         AND persona_id = ?
         AND episode_start_id IS NOT NULL
         AND episode_end_id IS NOT NULL
         AND episode_end_id >= ?
         AND episode_start_id <= ?
       ORDER BY episode_start_id ASC`
    )
    .all(input.personaId, input.episodeStartId, input.episodeEndId) as Array<{ episodeStartId: number; episodeEndId: number }>;
}

export function findUncoveredRanges(
  targetStart: number,
  targetEnd: number,
  coveredRanges: Array<{ episodeStartId: number; episodeEndId: number }>
): Array<{ episodeStartId: number; episodeEndId: number }> {
  const ranges = coveredRanges
    .map((range) => ({ episodeStartId: Math.max(targetStart, range.episodeStartId), episodeEndId: Math.min(targetEnd, range.episodeEndId) }))
    .filter((range) => range.episodeStartId <= range.episodeEndId)
    .sort((a, b) => a.episodeStartId - b.episodeStartId);
  const uncovered: Array<{ episodeStartId: number; episodeEndId: number }> = [];
  let cursor = targetStart;
  for (const range of ranges) {
    if (range.episodeEndId < cursor) continue;
    if (range.episodeStartId > cursor) uncovered.push({ episodeStartId: cursor, episodeEndId: range.episodeStartId - 1 });
    cursor = Math.max(cursor, range.episodeEndId + 1);
    if (cursor > targetEnd) break;
  }
  if (cursor <= targetEnd) uncovered.push({ episodeStartId: cursor, episodeEndId: targetEnd });
  return uncovered;
}

// ===== Facts (predicate-keyed) =====
export function upsertFact(row: {
  predicate: string;
  subject?: string;
  object: string;
  confidence?: number;
  source_episode_id?: number;
  cardinality?: FactCardinality;
  scope?: MemoryScope;
  persona_id?: string;
  project_id?: string;
  recall_policy?: RecallPolicy;
}): { id: number; supersededId?: number } {
  const db = getDb();
  const normalized = normalizeFactInput(row);
  return db.transaction(() => {
    if (normalized.cardinality === 'set') {
      const existingSet = db
        .prepare(
          `SELECT * FROM facts WHERE predicate = ? AND subject = ? AND object = ? AND status = 'active' AND cardinality = 'set' AND scope = ? AND COALESCE(persona_id, '') = ? AND COALESCE(project_id, '') = ? ORDER BY id DESC LIMIT 1`
        )
        .get(normalized.predicate, normalized.subject, normalized.object, normalized.scope, normalized.persona_id ?? '', normalized.project_id ?? '') as FactRow | undefined;
      if (existingSet) {
        db.prepare(`UPDATE facts SET confidence = MIN(1.0, confidence + 0.05), updated_at = ? WHERE id = ?`).run(Date.now(), existingSet.id);
        return { id: existingSet.id };
      }
      const r = db
        .prepare(
          `INSERT INTO facts (predicate, subject, object, confidence, status, created_at, updated_at, source_episode_id, cardinality, scope, persona_id, project_id, recall_policy)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 'set', ?, ?, ?, ?)`
        )
        .run(
          normalized.predicate,
          normalized.subject,
          normalized.object,
          normalized.confidence,
          Date.now(),
          Date.now(),
          normalized.source_episode_id ?? null,
          normalized.scope,
          normalized.persona_id ?? null,
          normalized.project_id ?? null,
          normalized.recall_policy
        );
      return { id: Number(r.lastInsertRowid) };
    }

    const activeFacts = db
      .prepare(
        `SELECT * FROM facts WHERE predicate = ? AND subject = ? AND status = 'active' AND cardinality = 'single' AND scope = ? AND COALESCE(persona_id, '') = ? AND COALESCE(project_id, '') = ? ORDER BY id DESC`
      )
      .all(normalized.predicate, normalized.subject, normalized.scope, normalized.persona_id ?? '', normalized.project_id ?? '') as FactRow[];
    const existing = activeFacts[0];

    if (existing && existing.object === normalized.object) {
      db.prepare(`UPDATE facts SET confidence = MIN(1.0, confidence + 0.05), updated_at = ? WHERE id = ?`).run(Date.now(), existing.id);
      return { id: existing.id };
    }

    const r = db
      .prepare(
        `INSERT INTO facts (predicate, subject, object, confidence, status, created_at, updated_at, source_episode_id, cardinality, scope, persona_id, project_id, recall_policy)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 'single', ?, ?, ?, ?)`
      )
      .run(
        normalized.predicate,
        normalized.subject,
        normalized.object,
        normalized.confidence,
        Date.now(),
        Date.now(),
        normalized.source_episode_id ?? null,
        normalized.scope,
        normalized.persona_id ?? null,
        normalized.project_id ?? null,
        normalized.recall_policy
      );
    const newId = Number(r.lastInsertRowid);

    db.prepare(
      `UPDATE facts SET status = 'superseded', superseded_by = ?, updated_at = ?
       WHERE predicate = ? AND subject = ? AND status = 'active' AND cardinality = 'single' AND id <> ? AND scope = ? AND COALESCE(persona_id, '') = ? AND COALESCE(project_id, '') = ?`
    ).run(newId, Date.now(), normalized.predicate, normalized.subject, newId, normalized.scope, normalized.persona_id ?? '', normalized.project_id ?? '');

    return existing ? { id: newId, supersededId: existing.id } : { id: newId };
  })();
}

export function setFactStatus(id: number, status: FactStatus) {
  const db = getDb();
  if (!['active', 'superseded', 'retracted'].includes(status)) {
    throw new Error('无效 fact status');
  }
  if (status !== 'active') {
    db.prepare(`UPDATE facts SET status = ? WHERE id = ?`).run(status, id);
    return;
  }
  db.transaction(() => {
    const fact = db.prepare(`SELECT * FROM facts WHERE id = ?`).get(id) as FactRow | undefined;
    if (!fact) return;
    if ((fact.cardinality ?? 'single') === 'single') {
      db.prepare(
        `UPDATE facts SET status = 'superseded', superseded_by = ?, updated_at = ?
         WHERE predicate = ? AND subject = ? AND status = 'active' AND cardinality = 'single' AND id <> ? AND scope = ? AND COALESCE(persona_id, '') = ? AND COALESCE(project_id, '') = ?`
      ).run(id, Date.now(), fact.predicate, fact.subject, id, fact.scope ?? 'global', fact.persona_id ?? '', fact.project_id ?? '');
    }
    db.prepare(`UPDATE facts SET status = 'active', superseded_by = NULL, updated_at = ? WHERE id = ?`).run(Date.now(), id);
  })();
}

export function listFacts(opts?: {
  status?: FactStatus;
  scope?: MemoryScope;
  personaId?: string;
  projectId?: string;
  query?: string;
  limit?: number;
}): FactRow[] {
  const limit = clampLimit(opts?.limit, 200, 1000);
  const clauses: string[] = [];
  const values: any[] = [];
  if (opts?.status) {
    clauses.push(`status = ?`);
    values.push(opts.status);
  }
  if (opts?.scope) {
    clauses.push(`scope = ?`);
    values.push(opts.scope);
  }
  if (opts?.personaId) {
    clauses.push(`persona_id = ?`);
    values.push(opts.personaId);
  }
  if (opts?.projectId) {
    clauses.push(`project_id = ?`);
    values.push(opts.projectId);
  }
  if (opts?.query?.trim()) {
    clauses.push(`(predicate LIKE ? OR subject LIKE ? OR object LIKE ?)`);
    const q = `%${opts.query.trim()}%`;
    values.push(q, q, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit);
  return getDb()
    .prepare(`SELECT * FROM facts ${where} ORDER BY id DESC LIMIT ?`)
    .all(...values)
    .map((row) => toNullable(row as FactRow));
}

export function listRecallableFacts(opts: {
  personaId?: string;
  projectId?: string;
  policies?: RecallPolicy[];
  limit?: number;
}): FactRow[] {
  const limit = clampLimit(opts.limit, 80, 500);
  const visible = visibleScopeSql('f', opts);
  const policies = opts.policies?.length ? opts.policies : ['always', 'on_topic'];
  const placeholders = policies.map(() => '?').join(',');
  return getDb()
    .prepare(
      `SELECT f.* FROM facts f
       WHERE f.status = 'active' AND f.recall_policy IN (${placeholders}) AND ${visible.sql}
       ORDER BY CASE f.scope WHEN 'project' THEN 0 WHEN 'persona' THEN 1 ELSE 2 END,
                COALESCE(f.updated_at, f.created_at) DESC,
                f.use_count DESC,
                f.id DESC
       LIMIT ?`
    )
    .all(...policies, ...visible.values, limit)
    .map((row) => toNullable(row as FactRow));
}

export function getActiveFactsByPredicate(predicate: string, subject = 'user'): FactRow[] {
  const normalized = normalizeFactInput({ predicate, subject, object: 'placeholder' });
  return getDb()
    .prepare(
      `SELECT * FROM facts WHERE predicate = ? AND subject = ? AND status = 'active' ORDER BY id DESC`
    )
    .all(normalized.predicate, normalized.subject) as FactRow[];
}

export function getDbFactById(id: number): FactRow | undefined {
  const row = getDb().prepare(`SELECT * FROM facts WHERE id = ?`).get(id) as FactRow | undefined;
  return row ? toNullable(row) : undefined;
}

export function updateFact(id: number, patch: Partial<{
  predicate: string;
  subject: string;
  object: string;
  confidence: number;
  status: FactStatus;
  cardinality: FactCardinality;
  scope: MemoryScope;
  persona_id?: string;
  project_id?: string;
  recall_policy: RecallPolicy;
}>) {
  const current = getDb().prepare(`SELECT * FROM facts WHERE id = ?`).get(id) as FactRow | undefined;
  if (!current) return;
  const normalized = normalizeFactInput({
    predicate: patch.predicate ?? current.predicate,
    subject: patch.subject ?? current.subject,
    object: patch.object ?? current.object,
    confidence: patch.confidence ?? current.confidence,
    cardinality: patch.cardinality ?? current.cardinality,
    scope: patch.scope ?? current.scope ?? 'global',
    persona_id: patch.persona_id ?? current.persona_id,
    project_id: patch.project_id ?? current.project_id,
    recall_policy: patch.recall_policy ?? current.recall_policy ?? 'on_topic'
  });
  const status = patch.status ? requireFactStatus(patch.status) : current.status;
  getDb().transaction(() => {
    getDb()
      .prepare(
        `UPDATE facts SET predicate = ?, subject = ?, object = ?, confidence = ?, status = ?, cardinality = ?, scope = ?, persona_id = ?, project_id = ?, recall_policy = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        normalized.predicate,
        normalized.subject,
        normalized.object,
        normalized.confidence,
        status,
        normalized.cardinality,
        normalized.scope,
        normalized.persona_id ?? null,
        normalized.project_id ?? null,
        normalized.recall_policy,
        Date.now(),
        id
      );
    deleteMemoryEmbeddingForMemory('fact', id);
  })();
}

function requireFactStatus(status: string): FactStatus {
  if (!['active', 'superseded', 'retracted'].includes(status)) throw new Error('无效 fact status');
  return status as FactStatus;
}

export function deleteFact(id: number) {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM memory_embeddings WHERE memory_type = 'fact' AND memory_id = ?`).run(id);
    db.prepare(`DELETE FROM memory_sources WHERE memory_type = 'fact' AND memory_id = ?`).run(id);
    db.prepare(`DELETE FROM graph_sync_state WHERE source_type = 'fact' AND source_id = ?`).run(id);
    db.prepare(`DELETE FROM facts WHERE id = ?`).run(id);
  })();
}

// ===== Tasks =====
export function appendTask(row: Omit<TaskRow, 'id' | 'memory_status' | 'recall_policy'> & Partial<Pick<TaskRow, 'memory_status' | 'recall_policy'>>): number {
  const r = getDb()
    .prepare(
      `INSERT INTO tasks (ts, session_id, transcript_path, summary, raw_json) VALUES (?, ?, ?, ?, ?)`
    )
    .run(row.ts, row.session_id ?? null, row.transcript_path ?? null, row.summary ?? '', row.raw_json);
  return Number(r.lastInsertRowid);
}

export function getTaskById(id: number): TaskRow | undefined {
  const row = getDb().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
  return row ? toNullable(row) : undefined;
}

export function listTasks(limit = 50): TaskRow[] {
  const safeLimit = clampLimit(limit, 50, 500);
  return getDb()
    .prepare(`SELECT * FROM tasks ORDER BY id DESC LIMIT ?`)
    .all(safeLimit)
    .map((row) => toNullable(row as TaskRow));
}

export function updateTaskMemoryState(
  id: number,
  patch: { memory_status?: TaskMemoryStatus; recall_policy?: RecallPolicy; user_note?: string }
) {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.memory_status !== undefined) {
    fields.push('memory_status = ?');
    values.push(requireTaskMemoryStatus(patch.memory_status));
  }
  if (patch.recall_policy !== undefined) {
    fields.push('recall_policy = ?');
    values.push(requireRecallPolicy(patch.recall_policy));
  }
  if (patch.user_note !== undefined) {
    fields.push('user_note = ?');
    values.push(String(patch.user_note).slice(0, 1000));
  }
  if (!fields.length) return;
  values.push(id);
  getDb().prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function promoteTaskToMemory(
  taskId: number,
  opts?: { title?: string; summary?: string; importance?: number; recall_policy?: RecallPolicy }
): { ok: boolean; summaryId: number } {
  const db = getDb();
  return db.transaction(() => {
    const task = getTaskById(taskId);
    if (!task) throw new Error('任务不存在');
    if (task.promoted_summary_id) return { ok: true, summaryId: task.promoted_summary_id };
    const summaryText = (opts?.summary ?? task.summary ?? '').trim();
    if (!summaryText) throw new Error('任务摘要为空, 不能提升为长期记忆');
    const summaryId = appendConversationSummary({
      ts: task.ts,
      title: opts?.title?.trim() || `Claude Code 任务 #${task.id}`,
      summary: summaryText,
      importance: opts?.importance ?? 0.8,
      kind: 'task_memory',
      keywords_json: '[]',
      entities_json: '[]',
      recall_policy: opts?.recall_policy ?? 'on_topic'
    });
    if (summaryId) {
      appendMemorySource({
        memory_type: 'conversation_summary',
        memory_id: summaryId,
        source_type: 'task',
        source_id: task.id,
        excerpt: taskExcerpt(task)
      });
    }
    db.prepare(
      `UPDATE tasks SET memory_status = 'promoted', recall_policy = ?, promoted_summary_id = ?, promoted_at = ? WHERE id = ?`
    ).run(requireRecallPolicy(opts?.recall_policy ?? 'on_topic'), summaryId, Date.now(), task.id);
    return { ok: true, summaryId };
  })();
}

export function listRecallableTasks(opts?: { query?: string; limit?: number; alwaysOnly?: boolean }): TaskRow[] {
  const limit = clampLimit(opts?.limit, 5, 50);
  const values: any[] = [];
  let sql = `SELECT * FROM tasks WHERE memory_status IN ('candidate', 'promoted') AND recall_policy IN ('always', 'on_topic')`;
  if (opts?.alwaysOnly) {
    sql = `SELECT * FROM tasks WHERE recall_policy = 'always' AND memory_status NOT IN ('disabled', 'unimportant')`;
  }
  if (opts?.query?.trim()) {
    const q = `%${opts.query.trim()}%`;
    sql += ` AND (summary LIKE ? OR user_note LIKE ?)`;
    values.push(q, q);
  }
  sql += ` ORDER BY CASE recall_policy WHEN 'always' THEN 0 ELSE 1 END, id DESC LIMIT ?`;
  values.push(limit);
  return getDb()
    .prepare(sql)
    .all(...values)
    .map((row) => toNullable(row as TaskRow));
}

// ===== Conversation summaries =====
export function appendConversationSummary(row: {
  ts: number;
  episode_start_id?: number;
  episode_end_id?: number;
  persona_id?: string;
  title: string;
  summary: string;
  importance?: number;
  kind: string;
  keywords_json?: string;
  entities_json?: string;
  recall_policy?: RecallPolicy;
  scope?: MemoryScope;
  project_id?: string;
}): number {
  const scope = normalizeMemoryScope({ scope: row.scope ?? (row.persona_id ? 'persona' : 'global'), persona_id: row.persona_id, project_id: row.project_id });
  const now = Date.now();
  const r = getDb()
    .prepare(
      `INSERT OR IGNORE INTO conversation_summaries
       (ts, episode_start_id, episode_end_id, persona_id, title, summary, importance, kind, keywords_json, entities_json, created_at, updated_at, status, recall_policy, scope, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    )
    .run(
      row.ts,
      row.episode_start_id ?? null,
      row.episode_end_id ?? null,
      scope.persona_id ?? row.persona_id ?? null,
      row.title.trim() || '重要对话',
      row.summary.trim(),
      Math.max(0, Math.min(1, Number(row.importance ?? 0.5))),
      row.kind.trim() || 'conversation',
      row.keywords_json ?? '[]',
      row.entities_json ?? '[]',
      now,
      now,
      requireRecallPolicy(row.recall_policy ?? 'on_topic'),
      scope.scope,
      scope.project_id ?? null
    );
  if (r.lastInsertRowid) return Number(r.lastInsertRowid);
  const existing = getDb()
    .prepare(
      `SELECT id FROM conversation_summaries
       WHERE episode_start_id IS ? AND episode_end_id IS ? AND kind = ? ORDER BY id DESC LIMIT 1`
    )
    .get(row.episode_start_id ?? null, row.episode_end_id ?? null, row.kind.trim() || 'conversation') as
    | { id: number }
    | undefined;
  return existing?.id ?? 0;
}

export function listConversationSummaries(opts?: {
  limit?: number;
  kind?: string;
  query?: string;
}): ConversationSummaryRow[] {
  const limit = clampLimit(opts?.limit, 50, 500);
  if (opts?.query?.trim()) {
    const q = `%${opts.query.trim()}%`;
    return getDb()
      .prepare(
        `SELECT * FROM conversation_summaries
         WHERE title LIKE ? OR summary LIKE ? OR keywords_json LIKE ? OR entities_json LIKE ?
         ORDER BY importance DESC, id DESC LIMIT ?`
      )
      .all(q, q, q, q, limit)
      .map((row) => toNullable(row as ConversationSummaryRow));
  }
  if (opts?.kind) {
    return getDb()
      .prepare(`SELECT * FROM conversation_summaries WHERE kind = ? ORDER BY id DESC LIMIT ?`)
      .all(opts.kind, limit)
      .map((row) => toNullable(row as ConversationSummaryRow));
  }
  return getDb()
    .prepare(`SELECT * FROM conversation_summaries ORDER BY id DESC LIMIT ?`)
    .all(limit)
    .map((row) => toNullable(row as ConversationSummaryRow));
}

export function listRecallableConversationSummaries(opts?: {
  limit?: number;
  query?: string;
  alwaysOnly?: boolean;
  personaId?: string;
  projectId?: string;
}): ConversationSummaryRow[] {
  const limit = clampLimit(opts?.limit, 5, 50);
  const values: any[] = [];
  const visible = visibleScopeSql('s', opts);
  let sql = `SELECT s.* FROM conversation_summaries s WHERE s.status = 'active' AND ${visible.sql}`;
  values.push(...visible.values);
  if (opts?.alwaysOnly || !opts?.query?.trim()) {
    sql += ` AND s.recall_policy = 'always'`;
  } else {
    sql += ` AND s.recall_policy IN ('always', 'on_topic')`;
  }
  if (opts?.query?.trim()) {
    const q = `%${opts.query.trim()}%`;
    sql += ` AND (s.title LIKE ? OR s.summary LIKE ? OR s.keywords_json LIKE ? OR s.entities_json LIKE ?)`;
    values.push(q, q, q, q);
  }
  sql += ` ORDER BY CASE s.recall_policy WHEN 'always' THEN 0 ELSE 1 END, s.importance DESC, s.id DESC LIMIT ?`;
  values.push(limit);
  return getDb()
    .prepare(sql)
    .all(...values)
    .map((row) => toNullable(row as ConversationSummaryRow));
}

export function getConversationSummaryById(id: number): ConversationSummaryRow | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM conversation_summaries WHERE id = ?`)
    .get(id) as ConversationSummaryRow | undefined;
  return row ? toNullable(row) : undefined;
}

export function deleteConversationSummary(id: number) {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM memory_embeddings WHERE memory_type = 'conversation_summary' AND memory_id = ?`).run(id);
    db.prepare(`DELETE FROM memory_sources WHERE memory_type = 'conversation_summary' AND memory_id = ?`).run(id);
    db.prepare(`DELETE FROM graph_sync_state WHERE source_type = 'conversation_summary' AND source_id = ?`).run(id);
    db.prepare(`DELETE FROM conversation_summaries WHERE id = ?`).run(id);
  })();
}

export function deleteEpisodeCascade(id: number) {
  const db = getDb();
  db.transaction(() => {
    const summaryRows = db
      .prepare(
        `SELECT DISTINCT s.id FROM conversation_summaries s
         LEFT JOIN memory_sources ms ON ms.memory_type = 'conversation_summary' AND ms.memory_id = s.id
         WHERE s.episode_start_id = ? OR s.episode_end_id = ? OR (ms.source_type = 'episode' AND ms.source_id = ?)`
      )
      .all(id, id, id) as Array<{ id: number }>;
    const factRows = db
      .prepare(
        `SELECT DISTINCT f.id FROM facts f
         LEFT JOIN memory_sources ms ON ms.memory_type = 'fact' AND ms.memory_id = f.id
         WHERE f.source_episode_id = ? OR (ms.source_type = 'episode' AND ms.source_id = ?)`
      )
      .all(id, id) as Array<{ id: number }>;
    for (const row of summaryRows) deleteConversationSummary(row.id);
    for (const row of factRows) deleteFact(row.id);
    db.prepare(`DELETE FROM memory_sources WHERE source_type = 'episode' AND source_id = ?`).run(id);
    db.prepare(`DELETE FROM episodes WHERE id = ?`).run(id);
  })();
}

export function markMemoryUsed(memoryType: EmbeddableMemoryType, id: number) {
  const now = Date.now();
  if (memoryType === 'fact') {
    getDb().prepare(`UPDATE facts SET use_count = use_count + 1, last_used_at = ? WHERE id = ?`).run(now, id);
    return;
  }
  getDb().prepare(`UPDATE conversation_summaries SET use_count = use_count + 1, last_used_at = ? WHERE id = ?`).run(now, id);
}

// ===== Memory jobs =====
export function enqueueMemoryJob(row: {
  type: string;
  payload_json: string;
  dedupe_key?: string;
}): number {
  const r = getDb()
    .prepare(
      `INSERT OR IGNORE INTO memory_jobs (type, status, dedupe_key, created_at, payload_json)
       VALUES (?, 'pending', ?, ?, ?)`
    )
    .run(row.type, row.dedupe_key ?? null, Date.now(), row.payload_json);
  if (r.lastInsertRowid) return Number(r.lastInsertRowid);
  if (!row.dedupe_key) return 0;
  const existing = getDb()
    .prepare(`SELECT id FROM memory_jobs WHERE dedupe_key = ?`)
    .get(row.dedupe_key) as { id: number } | undefined;
  return existing?.id ?? 0;
}

export function claimNextMemoryJob(types: string[]): MemoryJobRow | undefined {
  if (!types.length) return undefined;
  const db = getDb();
  const placeholders = types.map(() => '?').join(',');
  const now = Date.now();
  return db.transaction(() => {
    const job = db
      .prepare(
        `SELECT * FROM memory_jobs
         WHERE status = 'pending'
           AND type IN (${placeholders})
           AND (next_run_at IS NULL OR next_run_at <= ?)
           AND attempts < max_attempts
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(...types, now) as MemoryJobRow | undefined;
    if (!job) return undefined;
    db.prepare(
      `UPDATE memory_jobs
       SET status = 'running', started_at = ?, last_heartbeat_at = ?, attempts = attempts + 1, error = NULL
       WHERE id = ?`
    ).run(now, now, job.id);
    const updated = db.prepare(`SELECT * FROM memory_jobs WHERE id = ?`).get(job.id) as MemoryJobRow;
    return toNullable(updated);
  })();
}

export function updateMemoryJob(
  id: number,
  patch: Partial<Pick<MemoryJobRow, 'status' | 'started_at' | 'finished_at' | 'result_json' | 'error' | 'next_run_at' | 'last_heartbeat_at'>>
) {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.status !== undefined) {
    fields.push('status = ?');
    values.push(requireMemoryJobStatus(patch.status));
  }
  if (patch.started_at !== undefined) {
    fields.push('started_at = ?');
    values.push(patch.started_at);
  }
  if (patch.finished_at !== undefined) {
    fields.push('finished_at = ?');
    values.push(patch.finished_at);
  }
  if (patch.result_json !== undefined) {
    fields.push('result_json = ?');
    values.push(patch.result_json);
  }
  if (patch.error !== undefined) {
    fields.push('error = ?');
    values.push(patch.error);
  }
  if (patch.next_run_at !== undefined) {
    fields.push('next_run_at = ?');
    values.push(patch.next_run_at);
  }
  if (patch.last_heartbeat_at !== undefined) {
    fields.push('last_heartbeat_at = ?');
    values.push(patch.last_heartbeat_at);
  }
  if (!fields.length) return;
  values.push(id);
  getDb().prepare(`UPDATE memory_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function listMemoryJobs(opts?: {
  status?: MemoryJobStatus;
  limit?: number;
}): MemoryJobRow[] {
  const limit = clampLimit(opts?.limit, 60, 500);
  if (opts?.status) {
    return getDb()
      .prepare(`SELECT * FROM memory_jobs WHERE status = ? ORDER BY id DESC LIMIT ?`)
      .all(opts.status, limit)
      .map((row) => toNullable(row as MemoryJobRow));
  }
  return getDb()
    .prepare(`SELECT * FROM memory_jobs ORDER BY id DESC LIMIT ?`)
    .all(limit)
    .map((row) => toNullable(row as MemoryJobRow));
}

function retryDelayMs(attempts: number): number {
  if (attempts <= 1) return 30_000;
  if (attempts === 2) return 120_000;
  return 600_000;
}

export function failOrRetryMemoryJob(job: MemoryJobRow, error: string, retryable = true) {
  const now = Date.now();
  const attempts = Number(job.attempts ?? 0);
  const maxAttempts = Number(job.max_attempts ?? 3);
  if (retryable && attempts < maxAttempts) {
    getDb()
      .prepare(
        `UPDATE memory_jobs
         SET status = 'pending', finished_at = ?, next_run_at = ?, error = ?
         WHERE id = ?`
      )
      .run(now, now + retryDelayMs(attempts), error, job.id);
    return;
  }
  updateMemoryJob(job.id, { status: 'failed', finished_at: now, error });
}

export function recoverStaleMemoryJobs(opts?: { olderThanMs?: number }) {
  const olderThanMs = opts?.olderThanMs ?? 10 * 60 * 1000;
  const now = Date.now();
  const staleBefore = now - olderThanMs;
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM memory_jobs WHERE status = 'running' AND started_at IS NOT NULL AND started_at < ?`)
    .all(staleBefore) as MemoryJobRow[];
  db.transaction(() => {
    for (const job of rows) {
      const attempts = Number(job.attempts ?? 0);
      const maxAttempts = Number(job.max_attempts ?? 3);
      if (attempts < maxAttempts) {
        db.prepare(
          `UPDATE memory_jobs SET status = 'pending', next_run_at = ?, error = ? WHERE id = ?`
        ).run(now, 'Recovered stale running job after app restart', job.id);
      } else {
        db.prepare(
          `UPDATE memory_jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`
        ).run(now, 'Stale running job exceeded max attempts', job.id);
      }
    }
  })();
  return rows.length;
}

export function retryMemoryJob(id: number) {
  getDb()
    .prepare(
      `UPDATE memory_jobs
       SET status = 'pending', started_at = NULL, finished_at = NULL, next_run_at = NULL, last_heartbeat_at = NULL, attempts = 0, error = NULL
       WHERE id = ? AND status = 'failed'`
    )
    .run(id);
}

// ===== Embeddings =====
export function upsertMemoryEmbedding(row: {
  memory_type: EmbeddableMemoryType;
  memory_id: number;
  provider_id?: string;
  model: string;
  dimensions: number;
  vector: Buffer;
  text_hash: string;
  source_text?: string;
}) {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO memory_embeddings
       (memory_type, memory_id, provider_id, model, dimensions, vector, text_hash, source_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(memory_type, memory_id, model) DO UPDATE SET
         provider_id = excluded.provider_id,
         dimensions = excluded.dimensions,
         vector = excluded.vector,
         text_hash = excluded.text_hash,
         source_text = excluded.source_text,
         updated_at = excluded.updated_at`
    )
    .run(
      row.memory_type,
      row.memory_id,
      row.provider_id ?? null,
      row.model,
      row.dimensions,
      row.vector,
      row.text_hash,
      row.source_text ?? null,
      now,
      now
    );
}

export function getMemoryEmbedding(memoryType: EmbeddableMemoryType, memoryId: number, model: string): MemoryEmbeddingRow | undefined {
  const row = getDb()
    .prepare(`SELECT * FROM memory_embeddings WHERE memory_type = ? AND memory_id = ? AND model = ?`)
    .get(memoryType, memoryId, model) as MemoryEmbeddingRow | undefined;
  return row ? toNullable(row) : undefined;
}

export function listMemoryEmbeddings(model: string, memoryTypes: EmbeddableMemoryType[], limit = 5000): MemoryEmbeddingRow[] {
  if (!memoryTypes.length) return [];
  const safeLimit = clampLimit(limit, 5000, 50000);
  const placeholders = memoryTypes.map(() => '?').join(',');
  return getDb()
    .prepare(`SELECT * FROM memory_embeddings WHERE model = ? AND memory_type IN (${placeholders}) ORDER BY id DESC LIMIT ?`)
    .all(model, ...memoryTypes, safeLimit)
    .map((row) => toNullable(row as MemoryEmbeddingRow));
}

export function deleteMemoryEmbeddingForMemory(memoryType: EmbeddableMemoryType, memoryId: number) {
  getDb().prepare(`DELETE FROM memory_embeddings WHERE memory_type = ? AND memory_id = ?`).run(memoryType, memoryId);
}

export function listEmbeddableMemoryItems(model: string, limit = 32): Array<{ memory_type: EmbeddableMemoryType; memory_id: number }> {
  const safeLimit = clampLimit(limit, 32, 200);
  const summaries = getDb()
    .prepare(
      `SELECT 'conversation_summary' AS memory_type, s.id AS memory_id
       FROM conversation_summaries s
       LEFT JOIN memory_embeddings e ON e.memory_type = 'conversation_summary' AND e.memory_id = s.id AND e.model = ?
       WHERE s.status = 'active' AND s.recall_policy != 'never' AND e.id IS NULL
       ORDER BY s.id DESC LIMIT ?`
    )
    .all(model, safeLimit) as Array<{ memory_type: EmbeddableMemoryType; memory_id: number }>;
  const remaining = Math.max(0, safeLimit - summaries.length);
  const facts = remaining
    ? (getDb()
        .prepare(
          `SELECT 'fact' AS memory_type, f.id AS memory_id
           FROM facts f
           LEFT JOIN memory_embeddings e ON e.memory_type = 'fact' AND e.memory_id = f.id AND e.model = ?
           WHERE f.status = 'active' AND e.id IS NULL
           ORDER BY f.id DESC LIMIT ?`
        )
        .all(model, remaining) as Array<{ memory_type: EmbeddableMemoryType; memory_id: number }>)
    : [];
  return [...summaries, ...facts];
}

// ===== Sources / graph sync =====
export function appendMemorySource(row: {
  memory_type: string;
  memory_id: number;
  source_type: string;
  source_id: number;
  excerpt?: string;
}): number {
  const r = getDb()
    .prepare(
      `INSERT INTO memory_sources (memory_type, memory_id, source_type, source_id, excerpt, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(row.memory_type, row.memory_id, row.source_type, row.source_id, row.excerpt ?? null, Date.now());
  return Number(r.lastInsertRowid);
}

export function listMemorySources(memoryType: string, memoryId: number): MemorySourceRow[] {
  return getDb()
    .prepare(`SELECT * FROM memory_sources WHERE memory_type = ? AND memory_id = ? ORDER BY id ASC`)
    .all(memoryType, memoryId)
    .map((row) => toNullable(row as MemorySourceRow));
}

export function upsertGraphSyncState(row: {
  source_type: string;
  source_id: number;
  neo4j_element_id?: string;
  synced_at?: number;
  status: string;
  error?: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO graph_sync_state
       (source_type, source_id, neo4j_element_id, synced_at, status, error)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_type, source_id) DO UPDATE SET
         neo4j_element_id = excluded.neo4j_element_id,
         synced_at = excluded.synced_at,
         status = excluded.status,
         error = excluded.error`
    )
    .run(
      row.source_type,
      row.source_id,
      row.neo4j_element_id ?? null,
      row.synced_at ?? null,
      row.status,
      row.error ?? null
    );
}

export function listGraphSyncState(opts?: { status?: string; limit?: number }): GraphSyncStateRow[] {
  const limit = clampLimit(opts?.limit, 60, 500);
  if (opts?.status) {
    return getDb()
      .prepare(`SELECT * FROM graph_sync_state WHERE status = ? ORDER BY id DESC LIMIT ?`)
      .all(opts.status, limit)
      .map((row) => toNullable(row as GraphSyncStateRow));
  }
  return getDb()
    .prepare(`SELECT * FROM graph_sync_state ORDER BY id DESC LIMIT ?`)
    .all(limit)
    .map((row) => toNullable(row as GraphSyncStateRow));
}

// ===== 统计 =====
export function getMemoryStats(): MemoryStats {
  const db = getDb();
  const episodes = (db.prepare(`SELECT COUNT(*) AS c FROM episodes`).get() as any).c;
  const facts = (db.prepare(`SELECT COUNT(*) AS c FROM facts`).get() as any).c;
  const activeFacts = (db.prepare(`SELECT COUNT(*) AS c FROM facts WHERE status = 'active'`).get() as any).c;
  const tasks = (db.prepare(`SELECT COUNT(*) AS c FROM tasks`).get() as any).c;
  const summaries = (db.prepare(`SELECT COUNT(*) AS c FROM conversation_summaries`).get() as any).c;
  const pendingMemoryJobs = (db.prepare(`SELECT COUNT(*) AS c FROM memory_jobs WHERE status = 'pending'`).get() as any).c;
  const runningMemoryJobs = (db.prepare(`SELECT COUNT(*) AS c FROM memory_jobs WHERE status = 'running'`).get() as any).c;
  const failedMemoryJobs = (db.prepare(`SELECT COUNT(*) AS c FROM memory_jobs WHERE status = 'failed'`).get() as any).c;
  const graphSynced = (db.prepare(`SELECT COUNT(*) AS c FROM graph_sync_state WHERE status = 'synced'`).get() as any).c;
  const graphFailed = (db.prepare(`SELECT COUNT(*) AS c FROM graph_sync_state WHERE status = 'failed'`).get() as any).c;
  return {
    episodes,
    facts,
    activeFacts,
    tasks,
    summaries,
    pendingMemoryJobs,
    runningMemoryJobs,
    failedMemoryJobs,
    graphSynced,
    graphFailed,
    dbPath: join(app.getPath('userData'), 'reader-pet-memory.db')
  };
}

export function closeMemory() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
