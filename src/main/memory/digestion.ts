import { getConfig } from '../config';
import {
  appendConversationSummary,
  appendMemorySource,
  enqueueMemoryJob,
  getConversationSummaryById,
  getEpisodeById,
  listConversationSummaries,
  listEpisodesInRange,
  listMemorySources,
  updateMemoryJob,
  upsertFact,
  upsertGraphSyncState
} from './store';
import { embedMemoryItem, embedMissingMemories } from './embeddings';
import {
  extractDailyDigestFromEpisodes,
  extractImportantMemoryFromEpisodePair,
  extractMemoryFromEpisodePair,
  type MemoryExtraction
} from './extractor';
import {
  clearGraphProjection,
  deleteConversationSummaryFromGraph,
  deleteGraphRelationsBySource,
  markGraphRelationsBySourceStatus,
  syncConversationSummaryToGraph
} from './graph';
import type { MemoryJobRow } from '../../shared/types';

function parsePayload<T>(job: MemoryJobRow): T {
  return JSON.parse(job.payload_json) as T;
}

function excerpt(text: string): string {
  return text.trim().slice(0, 500);
}

function persistExtraction(input: {
  extraction: MemoryExtraction;
  personaId: string;
  ts: number;
  episodeStartId: number;
  episodeEndId: number;
  summaryKind: string;
  summaryScope?: 'persona' | 'global' | 'project';
  sources: Array<{ id: number; content: string }>;
}): { summaryId: number; factIds: number[] } {
  const cfg = getConfig().memory;
  let summaryId = 0;
  if (input.extraction.summary?.should_create) {
    summaryId = appendConversationSummary({
      ts: input.ts,
      episode_start_id: input.episodeStartId,
      episode_end_id: input.episodeEndId,
      persona_id: input.personaId,
      title: input.extraction.summary.title,
      summary: input.extraction.summary.summary,
      importance: input.extraction.importance,
      kind: input.summaryKind,
      keywords_json: JSON.stringify(input.extraction.summary.keywords),
      entities_json: JSON.stringify(input.extraction.summary.entities),
      scope: input.summaryScope ?? 'persona'
    });
    if (summaryId) {
      for (const source of input.sources) {
        appendMemorySource({
          memory_type: 'conversation_summary',
          memory_id: summaryId,
          source_type: 'episode',
          source_id: source.id,
          excerpt: excerpt(source.content)
        });
      }
    }
  }

  const factIds: number[] = [];
  const factSource = input.sources[0];
  for (const fact of input.extraction.facts) {
    const scope = fact.scope === 'global' || fact.scope === 'persona' || fact.scope === 'project' ? fact.scope : 'persona';
    const safeScope = scope === 'project' ? 'persona' : scope;
    const result = upsertFact({
      ...fact,
      scope: safeScope,
      persona_id: safeScope === 'persona' ? input.personaId : undefined,
      recall_policy: fact.recall_policy ?? 'on_topic',
      source_episode_id: factSource?.id
    });
    factIds.push(result.id);
    if (factSource) {
      appendMemorySource({
        memory_type: 'fact',
        memory_id: result.id,
        source_type: 'episode',
        source_id: factSource.id,
        excerpt: excerpt(factSource.content)
      });
    }
  }

  if (summaryId && cfg.graphEnabled && cfg.graphWriteEnabled) {
    enqueueMemoryJob({
      type: 'graph_sync_summary',
      dedupe_key: `graph_sync_summary:${summaryId}`,
      payload_json: JSON.stringify({ summaryId, extraction: input.extraction })
    });
  }
  if (cfg.embeddingEnabled) {
    if (summaryId) {
      enqueueMemoryJob({
        type: 'embed_memory_item',
        dedupe_key: `embed_memory_item:conversation_summary:${summaryId}`,
        payload_json: JSON.stringify({ memoryType: 'conversation_summary', memoryId: summaryId })
      });
    }
    for (const factId of factIds) {
      enqueueMemoryJob({
        type: 'embed_memory_item',
        dedupe_key: `embed_memory_item:fact:${factId}`,
        payload_json: JSON.stringify({ memoryType: 'fact', memoryId: factId })
      });
    }
  }
  return { summaryId, factIds };
}

export async function processMemoryJob(job: MemoryJobRow) {
  if (job.type === 'digest_episode_pair') {
    await digestEpisodePair(job);
    return;
  }
  if (job.type === 'digest_important_episode_pair') {
    await digestImportantEpisodePair(job);
    return;
  }
  if (job.type === 'digest_diary_range') {
    await digestDiaryRange(job);
    return;
  }
  if (job.type === 'graph_sync_summary') {
    await syncSummaryJob(job);
    return;
  }
  if (job.type === 'embed_memory_item') {
    await embedMemoryItemJob(job);
    return;
  }
  if (job.type === 'embed_missing_memories') {
    await embedMissingMemoriesJob(job);
    return;
  }
  if (job.type === 'graph_delete_summary') {
    await deleteGraphSummaryJob(job);
    return;
  }
  if (job.type === 'graph_retract_fact') {
    await retractGraphFactJob(job);
    return;
  }
  if (job.type === 'graph_delete_fact') {
    await deleteGraphFactJob(job);
    return;
  }
  if (job.type === 'graph_rebuild_all') {
    await rebuildGraphJob(job);
    return;
  }
  throw new Error(`未知 memory job type: ${job.type}`);
}

async function digestEpisodePair(job: MemoryJobRow) {
  const cfg = getConfig().memory;
  if (!cfg.digestionEnabled) {
    updateMemoryJob(job.id, { status: 'done', finished_at: Date.now(), result_json: '{"skipped":"digestion disabled"}' });
    return;
  }
  const payload = parsePayload<{
    userEpisodeId: number;
    assistantEpisodeId?: number;
    personaId: string;
  }>(job);
  const userEpisode = getEpisodeById(payload.userEpisodeId);
  if (!userEpisode) throw new Error(`user episode not found: ${payload.userEpisodeId}`);
  const assistantEpisode = payload.assistantEpisodeId ? getEpisodeById(payload.assistantEpisodeId) : undefined;
  const extraction = await extractMemoryFromEpisodePair({ userEpisode, assistantEpisode, personaId: payload.personaId });
  const persisted = persistExtraction({
    extraction,
    personaId: payload.personaId,
    ts: userEpisode.ts,
    episodeStartId: userEpisode.id,
    episodeEndId: assistantEpisode?.id ?? userEpisode.id,
    summaryKind: extraction.summary?.kind ?? 'conversation',
    sources: [
      { id: userEpisode.id, content: userEpisode.content },
      ...(assistantEpisode ? [{ id: assistantEpisode.id, content: assistantEpisode.content }] : [])
    ]
  });
  updateMemoryJob(job.id, { status: 'done', finished_at: Date.now(), result_json: JSON.stringify({ ...persisted, extraction }) });
}

async function digestImportantEpisodePair(job: MemoryJobRow) {
  const cfg = getConfig().memory;
  if (!cfg.digestionEnabled) {
    updateMemoryJob(job.id, { status: 'done', finished_at: Date.now(), result_json: '{"skipped":"digestion disabled"}' });
    return;
  }
  const payload = parsePayload<{
    userEpisodeId: number;
    assistantEpisodeId: number;
    personaId: string;
    triggerKind: string;
  }>(job);
  const userEpisode = getEpisodeById(payload.userEpisodeId);
  if (!userEpisode) throw new Error(`user episode not found: ${payload.userEpisodeId}`);
  const assistantEpisode = getEpisodeById(payload.assistantEpisodeId);
  if (!assistantEpisode) throw new Error(`assistant episode not found: ${payload.assistantEpisodeId}`);
  const extraction = await extractImportantMemoryFromEpisodePair({
    userEpisode,
    assistantEpisode,
    personaId: payload.personaId,
    triggerKind: payload.triggerKind
  });
  const persisted = persistExtraction({
    extraction,
    personaId: payload.personaId,
    ts: userEpisode.ts,
    episodeStartId: userEpisode.id,
    episodeEndId: assistantEpisode.id,
    summaryKind: 'important_digest',
    sources: [
      { id: userEpisode.id, content: userEpisode.content },
      { id: assistantEpisode.id, content: assistantEpisode.content }
    ]
  });
  updateMemoryJob(job.id, {
    status: 'done',
    finished_at: Date.now(),
    result_json: JSON.stringify({ ...persisted, triggerKind: payload.triggerKind, extraction })
  });
}

async function digestDiaryRange(job: MemoryJobRow) {
  const cfg = getConfig().memory;
  if (!cfg.digestionEnabled) {
    updateMemoryJob(job.id, { status: 'done', finished_at: Date.now(), result_json: '{"skipped":"digestion disabled"}' });
    return;
  }
  const payload = parsePayload<{
    personaId: string;
    localDay: string;
    episodeStartId: number;
    episodeEndId: number;
  }>(job);
  const episodes = listEpisodesInRange({
    personaId: payload.personaId,
    episodeStartId: payload.episodeStartId,
    episodeEndId: payload.episodeEndId
  });
  if (!episodes.length) throw new Error(`episodes not found: ${payload.episodeStartId}-${payload.episodeEndId}`);
  const extraction = await extractDailyDigestFromEpisodes({
    personaId: payload.personaId,
    localDay: payload.localDay,
    episodes
  });
  const sourceEpisodes = episodes.length <= 2 ? episodes : [episodes[0], episodes[episodes.length - 1]];
  const persisted = persistExtraction({
    extraction,
    personaId: payload.personaId,
    ts: episodes[0].ts,
    episodeStartId: payload.episodeStartId,
    episodeEndId: payload.episodeEndId,
    summaryKind: 'daily_digest',
    sources: sourceEpisodes.map((episode) => ({ id: episode.id, content: episode.content }))
  });
  updateMemoryJob(job.id, {
    status: 'done',
    finished_at: Date.now(),
    result_json: JSON.stringify({
      ...persisted,
      skipped: !persisted.summaryId && persisted.factIds.length === 0 ? 'no_summary' : undefined,
      localDay: payload.localDay,
      episodeCount: episodes.length,
      extraction
    })
  });
}

async function embedMemoryItemJob(job: MemoryJobRow) {
  const payload = parsePayload<{ memoryType: 'conversation_summary' | 'fact'; memoryId: number }>(job);
  const result = await embedMemoryItem(payload.memoryType, payload.memoryId);
  updateMemoryJob(job.id, { status: 'done', finished_at: Date.now(), result_json: JSON.stringify(result) });
}

async function embedMissingMemoriesJob(job: MemoryJobRow) {
  const result = await embedMissingMemories();
  updateMemoryJob(job.id, { status: 'done', finished_at: Date.now(), result_json: JSON.stringify(result) });
}

async function deleteGraphSummaryJob(job: MemoryJobRow) {
  const payload = parsePayload<{ summaryId: number }>(job);
  await deleteConversationSummaryFromGraph(payload.summaryId);
  upsertGraphSyncState({
    source_type: 'conversation_summary',
    source_id: payload.summaryId,
    status: 'deleted',
    synced_at: Date.now()
  });
  updateMemoryJob(job.id, { status: 'done', finished_at: Date.now(), result_json: JSON.stringify({ ok: true }) });
}

async function retractGraphFactJob(job: MemoryJobRow) {
  const payload = parsePayload<{ factId: number }>(job);
  await markGraphRelationsBySourceStatus('fact', payload.factId, 'retracted');
  upsertGraphSyncState({
    source_type: 'fact',
    source_id: payload.factId,
    status: 'retracted',
    synced_at: Date.now()
  });
  updateMemoryJob(job.id, { status: 'done', finished_at: Date.now(), result_json: JSON.stringify({ ok: true }) });
}

async function deleteGraphFactJob(job: MemoryJobRow) {
  const payload = parsePayload<{ factId: number }>(job);
  await deleteGraphRelationsBySource('fact', payload.factId);
  upsertGraphSyncState({
    source_type: 'fact',
    source_id: payload.factId,
    status: 'deleted',
    synced_at: Date.now()
  });
  updateMemoryJob(job.id, { status: 'done', finished_at: Date.now(), result_json: JSON.stringify({ ok: true }) });
}

async function rebuildGraphJob(job: MemoryJobRow) {
  await clearGraphProjection();
  const summaries = listConversationSummaries({ limit: 500 });
  let synced = 0;
  for (const summary of summaries) {
    if ((summary.status ?? 'active') !== 'active' || summary.recall_policy === 'never') continue;
    await syncConversationSummaryToGraph({
      summary,
      extraction: { importance: summary.importance, facts: [], entities: [], relations: [], decisions: [] },
      sources: listMemorySources('conversation_summary', summary.id)
    });
    upsertGraphSyncState({
      source_type: 'conversation_summary',
      source_id: summary.id,
      neo4j_element_id: `summary:${summary.id}`,
      synced_at: Date.now(),
      status: 'synced'
    });
    synced += 1;
  }
  updateMemoryJob(job.id, { status: 'done', finished_at: Date.now(), result_json: JSON.stringify({ synced }) });
}

async function syncSummaryJob(job: MemoryJobRow) {
  const payload = parsePayload<{ summaryId: number; extraction: MemoryExtraction }>(job);
  const summary = getConversationSummaryById(payload.summaryId);
  if (!summary) throw new Error(`summary not found: ${payload.summaryId}`);
  try {
    const result = await syncConversationSummaryToGraph({
      summary,
      extraction: payload.extraction,
      sources: listMemorySources('conversation_summary', summary.id)
    });
    upsertGraphSyncState({
      source_type: 'conversation_summary',
      source_id: summary.id,
      neo4j_element_id: result.neo4jElementId,
      synced_at: Date.now(),
      status: 'synced'
    });
    updateMemoryJob(job.id, { status: 'done', finished_at: Date.now(), result_json: JSON.stringify(result) });
  } catch (e: any) {
    upsertGraphSyncState({
      source_type: 'conversation_summary',
      source_id: summary.id,
      status: 'failed',
      error: e?.message ?? String(e)
    });
    throw e;
  }
}
