import { getActiveProvider } from '../config';
import { chat as providerChat } from '../providers';
import { inferFactCardinality } from './store';
import type { EpisodeRow, FactCardinality } from '../../shared/types';

export interface MemoryExtraction {
  importance: number;
  summary?: {
    should_create: boolean;
    title: string;
    kind: string;
    summary: string;
    keywords: string[];
    entities: string[];
  };
  facts: Array<{
    predicate: string;
    subject: string;
    object: string;
    confidence: number;
    cardinality?: FactCardinality;
  }>;
  entities: Array<{
    name: string;
    type: string;
    aliases?: string[];
  }>;
  relations: Array<{
    subject: string;
    subject_type?: string;
    predicate: string;
    object: string;
    object_type?: string;
    qualifier?: string;
    confidence: number;
    importance: number;
  }>;
  decisions: Array<{
    title: string;
    decision: string;
    reason?: string;
    alternatives_rejected?: string[];
    confidence: number;
  }>;
}

const EMPTY_EXTRACTION: MemoryExtraction = {
  importance: 0,
  facts: [],
  entities: [],
  relations: [],
  decisions: []
};

function clamp01(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function cleanJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function normalizeExtraction(raw: any): MemoryExtraction {
  const summaryRaw = raw?.summary;
  const extraction: MemoryExtraction = {
    importance: clamp01(raw?.importance, 0),
    summary: summaryRaw
      ? {
          should_create: !!summaryRaw.should_create,
          title: String(summaryRaw.title ?? '').slice(0, 120) || '重要对话',
          kind: String(summaryRaw.kind ?? 'conversation').slice(0, 50) || 'conversation',
          summary: String(summaryRaw.summary ?? '').slice(0, 1200),
          keywords: asArray(summaryRaw.keywords).map(String).filter(Boolean).slice(0, 12),
          entities: asArray(summaryRaw.entities).map(String).filter(Boolean).slice(0, 12)
        }
      : undefined,
    facts: asArray<any>(raw?.facts)
      .map((f) => ({
        predicate: String(f?.predicate ?? '').trim().toLowerCase(),
        subject: String(f?.subject ?? 'user').trim() || 'user',
        object: String(f?.object ?? '').trim(),
        confidence: clamp01(f?.confidence, 0.7),
        cardinality: f?.cardinality === 'set' || f?.cardinality === 'single'
          ? f.cardinality
          : inferFactCardinality(String(f?.predicate ?? '').trim().toLowerCase())
      }))
      .filter((f) => /^[a-z0-9_.-]{1,64}$/.test(f.predicate) && f.object)
      .slice(0, 5),
    entities: asArray<any>(raw?.entities)
      .map((e) => ({
        name: String(e?.name ?? '').trim(),
        type: String(e?.type ?? 'concept').trim().toLowerCase() || 'concept',
        aliases: asArray(e?.aliases).map(String).filter(Boolean).slice(0, 6)
      }))
      .filter((e) => e.name)
      .slice(0, 12),
    relations: asArray<any>(raw?.relations)
      .map((r) => ({
        subject: String(r?.subject ?? '').trim(),
        subject_type: String(r?.subject_type ?? 'concept').trim().toLowerCase() || 'concept',
        predicate: String(r?.predicate ?? 'RELATED_TO').trim().toUpperCase() || 'RELATED_TO',
        object: String(r?.object ?? '').trim(),
        object_type: String(r?.object_type ?? 'concept').trim().toLowerCase() || 'concept',
        qualifier: r?.qualifier ? String(r.qualifier).slice(0, 300) : undefined,
        confidence: clamp01(r?.confidence, 0.7),
        importance: clamp01(r?.importance, 0.5)
      }))
      .filter((r) => r.subject && r.object)
      .slice(0, 16),
    decisions: asArray<any>(raw?.decisions)
      .map((d) => ({
        title: String(d?.title ?? '').trim().slice(0, 120),
        decision: String(d?.decision ?? '').trim().slice(0, 800),
        reason: d?.reason ? String(d.reason).slice(0, 800) : undefined,
        alternatives_rejected: asArray(d?.alternatives_rejected).map(String).filter(Boolean).slice(0, 5),
        confidence: clamp01(d?.confidence, 0.7)
      }))
      .filter((d) => d.title && d.decision)
      .slice(0, 5)
  };
  if (extraction.summary && (!extraction.summary.should_create || !extraction.summary.summary.trim())) {
    extraction.summary = undefined;
  }
  return extraction;
}

export async function extractMemoryFromEpisodePair(input: {
  userEpisode: EpisodeRow;
  assistantEpisode?: EpisodeRow;
  personaId: string;
}): Promise<MemoryExtraction> {
  const provider = getActiveProvider();
  if (!provider) throw new Error('尚未配置 API provider, 无法整理记忆');
  const source = [
    `persona_id: ${input.personaId}`,
    `user episode #${input.userEpisode.id}: ${input.userEpisode.content}`,
    input.assistantEpisode
      ? `assistant episode #${input.assistantEpisode.id}: ${input.assistantEpisode.content}`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n');
  const resp = await providerChat(provider, {
    messages: [
      {
        role: 'system',
        content:
          '你是 reader-pet 的长期记忆整理器。只输出严格 JSON, 不要 markdown。只抽取长期有用且能由原文支持的记忆: 用户偏好、伴侣连续性、项目决策、创作世界观、工具任务结果、边界和来源可追溯内容。不要记录玩笑、假设、短期寒暄, 不要编造。事实 cardinality: single 表示同 predicate+subject 只能有一个当前值; set 表示可同时存在多个值, 用于 likes/dislikes/interests/boundaries/tools/ongoing_projects/writing_themes 等偏好、边界、兴趣、项目列表。JSON schema: {"importance":0..1,"summary":{"should_create":boolean,"title":string,"kind":string,"summary":string,"keywords":string[],"entities":string[]},"facts":[{"predicate":"lower_snake_key","subject":"user","object":string,"confidence":0..1,"cardinality":"single|set"}],"entities":[{"name":string,"type":string,"aliases":string[]}],"relations":[{"subject":string,"subject_type":string,"predicate":string,"object":string,"object_type":string,"qualifier":string,"confidence":0..1,"importance":0..1}],"decisions":[{"title":string,"decision":string,"reason":string,"alternatives_rejected":string[],"confidence":0..1}]}'
      },
      { role: 'user', content: source }
    ],
    maxTokens: 3000,
    temperature: 0
  });
  try {
    return normalizeExtraction(JSON.parse(cleanJsonText(resp.text ?? '')));
  } catch {
    return EMPTY_EXTRACTION;
  }
}
