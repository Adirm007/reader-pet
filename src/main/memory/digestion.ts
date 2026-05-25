import { getConfig } from '../config';
import {
  appendConversationSummary,
  appendMemorySource,
  enqueueMemoryJob,
  getConversationSummaryById,
  getEpisodeById,
  listMemorySources,
  updateMemoryJob,
  upsertFact,
  upsertGraphSyncState
} from './store';
import { extractMemoryFromEpisodePair, type MemoryExtraction } from './extractor';
import { syncConversationSummaryToGraph } from './graph';
import type { MemoryJobRow } from '../../shared/types';

function parsePayload<T>(job: MemoryJobRow): T {
  return JSON.parse(job.payload_json) as T;
}

function excerpt(text: string): string {
  return text.trim().slice(0, 500);
}

export async function processMemoryJob(job: MemoryJobRow) {
  if (job.type === 'digest_episode_pair') {
    await digestEpisodePair(job);
    return;
  }
  if (job.type === 'graph_sync_summary') {
    await syncSummaryJob(job);
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
  let summaryId = 0;
  if (extraction.summary?.should_create) {
    summaryId = appendConversationSummary({
      ts: userEpisode.ts,
      episode_start_id: userEpisode.id,
      episode_end_id: assistantEpisode?.id ?? userEpisode.id,
      persona_id: payload.personaId,
      title: extraction.summary.title,
      summary: extraction.summary.summary,
      importance: extraction.importance,
      kind: extraction.summary.kind,
      keywords_json: JSON.stringify(extraction.summary.keywords),
      entities_json: JSON.stringify(extraction.summary.entities)
    });
    if (summaryId) {
      appendMemorySource({
        memory_type: 'conversation_summary',
        memory_id: summaryId,
        source_type: 'episode',
        source_id: userEpisode.id,
        excerpt: excerpt(userEpisode.content)
      });
      if (assistantEpisode) {
        appendMemorySource({
          memory_type: 'conversation_summary',
          memory_id: summaryId,
          source_type: 'episode',
          source_id: assistantEpisode.id,
          excerpt: excerpt(assistantEpisode.content)
        });
      }
    }
  }
  const factIds: number[] = [];
  for (const fact of extraction.facts) {
    const result = upsertFact({ ...fact, source_episode_id: userEpisode.id });
    factIds.push(result.id);
    appendMemorySource({
      memory_type: 'fact',
      memory_id: result.id,
      source_type: 'episode',
      source_id: userEpisode.id,
      excerpt: excerpt(userEpisode.content)
    });
  }
  const resultJson = JSON.stringify({ summaryId, factIds, extraction });
  updateMemoryJob(job.id, { status: 'done', finished_at: Date.now(), result_json: resultJson });
  if (summaryId && cfg.graphEnabled && cfg.graphWriteEnabled) {
    enqueueMemoryJob({
      type: 'graph_sync_summary',
      dedupe_key: `graph_sync_summary:${summaryId}`,
      payload_json: JSON.stringify({ summaryId, extraction })
    });
  }
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
