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
  EpisodeRow,
  FactRow,
  FactStatus,
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
  `);
}

// ===== Episode =====
export function appendEpisode(row: Omit<EpisodeRow, 'id'>): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO episodes (ts, role, content, persona_id, session_id) VALUES (?, ?, ?, ?, ?)`
  );
  const r = stmt.run(row.ts, row.role, row.content, row.persona_id, row.session_id ?? null);
  return Number(r.lastInsertRowid);
}

export function searchEpisodes(query: string, limit = 10): EpisodeRow[] {
  const db = getDb();
  // FTS5 容易因特殊字符报错, 简单清洗
  const q = query.replace(/["'`]/g, ' ').trim();
  if (!q) return [];
  const stmt = db.prepare(`
    SELECT e.* FROM episodes_fts f JOIN episodes e ON e.id = f.rowid
    WHERE episodes_fts MATCH ? ORDER BY rank LIMIT ?
  `);
  try {
    return stmt.all(q, limit) as EpisodeRow[];
  } catch {
    return [];
  }
}

export function recentEpisodes(limit = 50, persona?: string): EpisodeRow[] {
  const db = getDb();
  if (persona) {
    return db
      .prepare(`SELECT * FROM episodes WHERE persona_id = ? ORDER BY id DESC LIMIT ?`)
      .all(persona, limit) as EpisodeRow[];
  }
  return db
    .prepare(`SELECT * FROM episodes ORDER BY id DESC LIMIT ?`)
    .all(limit) as EpisodeRow[];
}

// ===== Facts (predicate-keyed) =====
export function upsertFact(row: {
  predicate: string;
  subject: string;
  object: string;
  confidence?: number;
  source_episode_id?: number;
}): { id: number; supersededId?: number } {
  const db = getDb();
  // 找出当前 active 同 (predicate, subject) 事实
  const existing = db
    .prepare(
      `SELECT * FROM facts WHERE predicate = ? AND subject = ? AND status = 'active' ORDER BY id DESC LIMIT 1`
    )
    .get(row.predicate, row.subject) as FactRow | undefined;

  // 同值不重复插入, 提升一下置信度即可
  if (existing && existing.object === row.object) {
    db.prepare(
      `UPDATE facts SET confidence = MIN(1.0, confidence + 0.05) WHERE id = ?`
    ).run(existing.id);
    return { id: existing.id };
  }

  const insert = db.prepare(
    `INSERT INTO facts (predicate, subject, object, confidence, status, created_at, source_episode_id)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  );
  const r = insert.run(
    row.predicate,
    row.subject,
    row.object,
    row.confidence ?? 0.8,
    Date.now(),
    row.source_episode_id ?? null
  );
  const newId = Number(r.lastInsertRowid);

  if (existing) {
    db.prepare(
      `UPDATE facts SET status = 'superseded', superseded_by = ? WHERE id = ?`
    ).run(newId, existing.id);
    return { id: newId, supersededId: existing.id };
  }
  return { id: newId };
}

export function setFactStatus(id: number, status: FactStatus) {
  getDb().prepare(`UPDATE facts SET status = ? WHERE id = ?`).run(status, id);
}

export function listFacts(opts?: { status?: FactStatus; limit?: number }): FactRow[] {
  const db = getDb();
  const status = opts?.status ?? 'active';
  const limit = opts?.limit ?? 200;
  return db
    .prepare(`SELECT * FROM facts WHERE status = ? ORDER BY id DESC LIMIT ?`)
    .all(status, limit) as FactRow[];
}

export function getActiveFactsByPredicate(predicate: string, subject = 'user'): FactRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM facts WHERE predicate = ? AND subject = ? AND status = 'active' ORDER BY id DESC`
    )
    .all(predicate, subject) as FactRow[];
}

export function deleteFact(id: number) {
  getDb().prepare(`DELETE FROM facts WHERE id = ?`).run(id);
}

// ===== Tasks =====
export function appendTask(row: Omit<TaskRow, 'id'>): number {
  const r = getDb()
    .prepare(
      `INSERT INTO tasks (ts, session_id, transcript_path, summary, raw_json) VALUES (?, ?, ?, ?, ?)`
    )
    .run(row.ts, row.session_id ?? null, row.transcript_path ?? null, row.summary ?? '', row.raw_json);
  return Number(r.lastInsertRowid);
}

export function listTasks(limit = 50): TaskRow[] {
  return getDb()
    .prepare(`SELECT * FROM tasks ORDER BY id DESC LIMIT ?`)
    .all(limit) as TaskRow[];
}

// ===== 统计 =====
export function getMemoryStats(): MemoryStats {
  const db = getDb();
  const episodes = (db.prepare(`SELECT COUNT(*) AS c FROM episodes`).get() as any).c;
  const facts = (db.prepare(`SELECT COUNT(*) AS c FROM facts`).get() as any).c;
  const activeFacts = (db.prepare(`SELECT COUNT(*) AS c FROM facts WHERE status = 'active'`).get() as any).c;
  const tasks = (db.prepare(`SELECT COUNT(*) AS c FROM tasks`).get() as any).c;
  return {
    episodes,
    facts,
    activeFacts,
    tasks,
    dbPath: join(app.getPath('userData'), 'reader-pet-memory.db')
  };
}

export function closeMemory() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
