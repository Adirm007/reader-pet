import crypto from 'crypto';
import { getActiveProvider, getConfig } from '../config';
import { embed } from '../providers';
import {
  getConversationSummaryById,
  getMemoryEmbedding,
  getDbFactById,
  listEmbeddableMemoryItems,
  listMemoryEmbeddings,
  upsertMemoryEmbedding
} from './store';
import type { EmbeddableMemoryType, FactRow, ConversationSummaryRow } from '../../shared/types';

function textHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function normalizeVector(vector: number[]): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum) || 1;
  return Float32Array.from(vector.map((value) => value / norm));
}

function vectorToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

function bufferToVector(buffer: Buffer, dimensions: number): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, dimensions);
}

function dot(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let score = 0;
  for (let i = 0; i < len; i++) score += a[i] * b[i];
  return score;
}

function getEmbeddingProvider() {
  const cfg = getConfig();
  const providerId = cfg.memory.embeddingProviderId || cfg.activeProviderId;
  const provider = providerId ? cfg.providers.find((p) => p.id === providerId) : getActiveProvider();
  if (!provider) throw new Error('尚未配置 embedding provider');
  return provider;
}

function embeddingModel(): string {
  const cfg = getConfig();
  const provider = getEmbeddingProvider();
  return cfg.memory.embeddingModel?.trim() || provider.embeddingModel?.trim() || provider.model;
}

function buildSummaryText(summary: ConversationSummaryRow): string {
  return [
    `标题: ${summary.title}`,
    `类型: ${summary.kind}`,
    `摘要: ${summary.summary}`,
    summary.keywords_json ? `关键词: ${summary.keywords_json}` : '',
    summary.entities_json ? `实体: ${summary.entities_json}` : ''
  ].filter(Boolean).join('\n');
}

function buildFactText(fact: FactRow): string {
  return `事实(${fact.scope ?? 'global'}/${fact.recall_policy ?? 'on_topic'}): ${fact.subject} 的 ${fact.predicate} 是 ${fact.object}`;
}

function isVisible(scope: string | undefined, personaId?: string, projectId?: string, memoryPersonaId?: string, memoryProjectId?: string) {
  if (!scope || scope === 'global') return true;
  if (scope === 'persona') return !!personaId && memoryPersonaId === personaId;
  if (scope === 'project') return !!projectId && memoryProjectId === projectId;
  return false;
}

export function buildMemoryEmbeddingText(memoryType: EmbeddableMemoryType, row: ConversationSummaryRow | FactRow): string {
  return memoryType === 'conversation_summary'
    ? buildSummaryText(row as ConversationSummaryRow)
    : buildFactText(row as FactRow);
}

export async function embedMemoryItem(memoryType: EmbeddableMemoryType, memoryId: number): Promise<{ skipped?: string; embedded?: boolean }> {
  const cfg = getConfig();
  if (!cfg.memory.embeddingEnabled) return { skipped: 'embedding disabled' };
  const provider = getEmbeddingProvider();
  const model = embeddingModel();
  const row = memoryType === 'conversation_summary' ? getConversationSummaryById(memoryId) : getDbFactById(memoryId);
  if (!row) throw new Error(`${memoryType} not found: ${memoryId}`);
  if (memoryType === 'conversation_summary') {
    const summary = row as ConversationSummaryRow;
    if ((summary.status ?? 'active') !== 'active' || summary.recall_policy === 'never') return { skipped: 'not recallable' };
  } else {
    const fact = row as FactRow;
    if (fact.status !== 'active') return { skipped: 'not active' };
  }
  const sourceText = buildMemoryEmbeddingText(memoryType, row).slice(0, 1200);
  const hash = textHash(sourceText);
  const existing = getMemoryEmbedding(memoryType, memoryId, model);
  if (existing?.text_hash === hash) return { skipped: 'unchanged' };
  const resp = await embed(provider, { texts: [sourceText], model });
  const vector = resp.vectors[0]?.vector;
  if (!vector?.length) throw new Error('embedding provider 返回空向量');
  const normalized = normalizeVector(vector);
  upsertMemoryEmbedding({
    memory_type: memoryType,
    memory_id: memoryId,
    provider_id: provider.id,
    model: resp.model || model,
    dimensions: normalized.length,
    vector: vectorToBuffer(normalized),
    text_hash: hash,
    source_text: sourceText
  });
  return { embedded: true };
}

export async function embedMissingMemories(): Promise<{ processed: number; embedded: number }> {
  const cfg = getConfig();
  if (!cfg.memory.embeddingEnabled) return { processed: 0, embedded: 0 };
  const model = embeddingModel();
  const items = listEmbeddableMemoryItems(model, cfg.memory.embeddingBackfillBatchSize);
  let embedded = 0;
  for (const item of items) {
    const result = await embedMemoryItem(item.memory_type, item.memory_id);
    if (result.embedded) embedded++;
  }
  return { processed: items.length, embedded };
}

export async function searchVectorMemories(query: string, opts?: { limit?: number; minScore?: number; personaId?: string; projectId?: string }): Promise<Array<{
  memoryType: EmbeddableMemoryType;
  memoryId: number;
  score: number;
  text?: string;
}>> {
  const cfg = getConfig();
  if (!cfg.memory.embeddingEnabled || !cfg.memory.vectorRecallEnabled || !query.trim()) return [];
  const provider = getEmbeddingProvider();
  const model = embeddingModel();
  const resp = await embed(provider, { texts: [query.slice(0, 1000)], model });
  const queryVector = resp.vectors[0]?.vector;
  if (!queryVector?.length) return [];
  const normalizedQuery = normalizeVector(queryVector);
  const rows = listMemoryEmbeddings(model, ['conversation_summary', 'fact']);
  const minScore = opts?.minScore ?? cfg.memory.vectorMinScore;
  const limit = Math.max(1, Math.min(20, Math.floor(opts?.limit ?? cfg.memory.vectorRecallLimit)));
  return rows
    .filter((row) => row.dimensions === normalizedQuery.length)
    .map((row) => ({
      memoryType: row.memory_type,
      memoryId: row.memory_id,
      score: dot(normalizedQuery, bufferToVector(row.vector, row.dimensions)),
      text: row.source_text
    }))
    .filter((hit) => hit.score >= minScore)
    .filter((hit) => {
      if (hit.memoryType === 'fact') {
        const fact = getDbFactById(hit.memoryId);
        return !!fact && fact.status === 'active' && !['manual_only', 'never'].includes(fact.recall_policy ?? 'on_topic') && isVisible(fact.scope, opts?.personaId, opts?.projectId, fact.persona_id, fact.project_id);
      }
      const summary = getConversationSummaryById(hit.memoryId);
      return !!summary && (summary.status ?? 'active') === 'active' && !['manual_only', 'never'].includes(summary.recall_policy ?? 'on_topic') && isVisible(summary.scope, opts?.personaId, opts?.projectId, summary.persona_id, summary.project_id);
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
