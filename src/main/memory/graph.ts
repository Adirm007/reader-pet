import crypto from 'crypto';
import { getConfig } from '../config';
import { runGraphQuery } from './neo4j-client';
import type { ConversationSummaryRow, MemorySourceRow } from '../../shared/types';
import type { MemoryExtraction } from './extractor';

export interface GraphRecallHit {
  text: string;
  source?: string;
  importance?: number;
}

let schemaReady = false;

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

function entityKey(type: string, name: string): string {
  return `${normalizeKeyPart(type || 'concept')}:${normalizeKeyPart(name)}`;
}

function hashKey(...parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

async function mergeRel(params: {
  fromKey: string;
  toKey: string;
  predicate: string;
  qualifier?: string;
  confidence?: number;
  importance?: number;
  sourceType?: string;
  sourceId?: number;
}) {
  const relKey = hashKey(
    params.fromKey,
    params.predicate,
    params.toKey,
    `${params.sourceType ?? ''}:${params.sourceId ?? ''}`
  );
  await runGraphQuery(
    `MATCH (a {key: $fromKey}), (b {key: $toKey})
     MERGE (a)-[r:REL {key: $relKey}]->(b)
     SET r.predicate = $predicate,
         r.qualifier = $qualifier,
         r.confidence = $confidence,
         r.importance = $importance,
         r.source_type = $sourceType,
         r.source_id = $sourceId,
         r.status = 'active',
         r.updated_at = $now,
         r.created_at = coalesce(r.created_at, $now)`,
    {
      fromKey: params.fromKey,
      toKey: params.toKey,
      relKey,
      predicate: params.predicate,
      qualifier: params.qualifier ?? null,
      confidence: params.confidence ?? 0.7,
      importance: params.importance ?? 0.5,
      sourceType: params.sourceType ?? null,
      sourceId: params.sourceId ?? null,
      now: Date.now()
    }
  );
}

async function mergeEntity(entity: { name: string; type: string; aliases?: string[] }) {
  const key = entityKey(entity.type, entity.name);
  await runGraphQuery(
    `MERGE (e:Entity {key: $key})
     SET e.name = $name,
         e.type = $type,
         e.aliases = $aliases,
         e.updated_at = $now,
         e.created_at = coalesce(e.created_at, $now)`,
    {
      key,
      name: entity.name,
      type: entity.type || 'concept',
      aliases: entity.aliases ?? [],
      now: Date.now()
    }
  );
  return key;
}

export async function initGraphSchema() {
  const cfg = getConfig().memory;
  if (!cfg.graphEnabled || schemaReady) return;
  await runGraphQuery(`CREATE CONSTRAINT entity_key IF NOT EXISTS FOR (e:Entity) REQUIRE e.key IS UNIQUE`);
  await runGraphQuery(
    `CREATE CONSTRAINT summary_sqlite_id IF NOT EXISTS FOR (s:ConversationSummary) REQUIRE s.sqlite_id IS UNIQUE`
  );
  await runGraphQuery(`CREATE CONSTRAINT source_key IF NOT EXISTS FOR (s:Source) REQUIRE s.key IS UNIQUE`);
  schemaReady = true;
}

export async function syncConversationSummaryToGraph(input: {
  summary: ConversationSummaryRow;
  extraction: MemoryExtraction;
  sources: MemorySourceRow[];
}): Promise<{ ok: true; neo4jElementId?: string }> {
  const cfg = getConfig().memory;
  if (!cfg.graphEnabled || !cfg.graphWriteEnabled) return { ok: true };
  await initGraphSchema();
  const now = Date.now();
  const summaryKey = `summary:${input.summary.id}`;
  await runGraphQuery(
    `MERGE (s:ConversationSummary {sqlite_id: $sqliteId})
     SET s.key = $key,
         s.title = $title,
         s.summary = $summary,
         s.kind = $kind,
         s.importance = $importance,
         s.episode_start_id = $episodeStartId,
         s.episode_end_id = $episodeEndId,
         s.persona_id = $personaId,
         s.updated_at = $now,
         s.created_at = coalesce(s.created_at, $createdAt)`,
    {
      sqliteId: input.summary.id,
      key: summaryKey,
      title: input.summary.title,
      summary: input.summary.summary,
      kind: input.summary.kind,
      importance: input.summary.importance,
      episodeStartId: input.summary.episode_start_id ?? null,
      episodeEndId: input.summary.episode_end_id ?? null,
      personaId: input.summary.persona_id ?? null,
      createdAt: input.summary.created_at,
      now
    }
  );

  const entities = new Map<string, string>();
  for (const entity of input.extraction.entities) {
    entities.set(entity.name, await mergeEntity(entity));
  }
  for (const name of input.summary.entities_json ? JSON.parse(input.summary.entities_json) : []) {
    if (!entities.has(String(name))) {
      entities.set(String(name), await mergeEntity({ name: String(name), type: 'concept' }));
    }
  }
  for (const [name, key] of entities) {
    await mergeRel({ fromKey: summaryKey, toKey: key, predicate: 'ABOUT', importance: input.summary.importance });
    await mergeRel({ fromKey: key, toKey: summaryKey, predicate: 'MENTIONED_IN', importance: input.summary.importance });
  }

  for (const source of input.sources) {
    const sourceKey = `${source.source_type}:${source.source_id}`;
    await runGraphQuery(
      `MERGE (s:Source {key: $key})
       SET s.source_type = $sourceType, s.source_id = $sourceId, s.updated_at = $now,
           s.created_at = coalesce(s.created_at, $now)`,
      { key: sourceKey, sourceType: source.source_type, sourceId: source.source_id, now }
    );
    await mergeRel({ fromKey: summaryKey, toKey: sourceKey, predicate: 'SOURCE' });
  }

  for (const relation of input.extraction.relations) {
    const fromKey = entities.get(relation.subject) ?? (await mergeEntity({ name: relation.subject, type: relation.subject_type ?? 'concept' }));
    const toKey = entities.get(relation.object) ?? (await mergeEntity({ name: relation.object, type: relation.object_type ?? 'concept' }));
    await mergeRel({
      fromKey,
      toKey,
      predicate: relation.predicate,
      qualifier: relation.qualifier,
      confidence: relation.confidence,
      importance: relation.importance,
      sourceType: 'conversation_summary',
      sourceId: input.summary.id
    });
  }

  for (const decision of input.extraction.decisions) {
    const decisionKey = await mergeEntity({ name: decision.title, type: 'decision' });
    await mergeRel({ fromKey: decisionKey, toKey: summaryKey, predicate: 'MENTIONED_IN', confidence: decision.confidence });
    if (decision.reason) {
      const reasonKey = await mergeEntity({ name: decision.reason, type: 'reason' });
      await mergeRel({ fromKey: decisionKey, toKey: reasonKey, predicate: 'REASON', confidence: decision.confidence });
    }
  }

  return { ok: true, neo4jElementId: summaryKey };
}

export async function recallGraphContext(input: {
  query: string;
  limit?: number;
  timeoutMs?: number;
}): Promise<GraphRecallHit[]> {
  const cfg = getConfig().memory;
  if (!cfg.graphEnabled || !cfg.graphRecallEnabled) return [];
  try {
    const rows = await runGraphQuery<any>(
      `MATCH (e:Entity)
       WHERE toLower(e.name) CONTAINS toLower($q)
          OR any(a IN coalesce(e.aliases, []) WHERE toLower(a) CONTAINS toLower($q))
       WITH e LIMIT 5
       MATCH (e)-[r:REL*1..2]-(x)
       RETURN e.name AS start, x.name AS other, x.title AS otherTitle,
              [rel IN r | rel.predicate] AS predicates,
              [rel IN r | rel.qualifier] AS qualifiers,
              [rel IN r | rel.importance] AS importances
       LIMIT $limit`,
      { q: input.query.slice(0, 80), limit: input.limit ?? 12 },
      input.timeoutMs ?? cfg.graphRecallTimeoutMs
    );
    return rows.map((row) => {
      const predicates = Array.isArray(row.predicates) ? row.predicates.filter(Boolean).join(' / ') : 'RELATED_TO';
      const qualifiers = Array.isArray(row.qualifiers) ? row.qualifiers.filter(Boolean).join('; ') : '';
      return {
        text: `${row.start} —[${predicates}]— ${row.other ?? row.otherTitle ?? '相关记忆'}${qualifiers ? `: ${qualifiers}` : ''}`,
        importance: Math.max(...(Array.isArray(row.importances) ? row.importances.map(Number).filter(Number.isFinite) : [0.5]))
      };
    });
  } catch {
    return [];
  }
}
