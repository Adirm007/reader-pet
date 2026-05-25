import { getActiveProvider } from '../config';
import { chat as providerChat } from '../providers';
import { inferFactCardinality } from './store';
import type { EpisodeRow, FactCardinality, MemoryScope, RecallPolicy } from '../../shared/types';

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
    scope?: MemoryScope;
    recall_policy?: RecallPolicy;
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
          : inferFactCardinality(String(f?.predicate ?? '').trim().toLowerCase()),
        scope: f?.scope === 'global' || f?.scope === 'persona' || f?.scope === 'project' ? f.scope : undefined,
        recall_policy: f?.recall_policy === 'always' || f?.recall_policy === 'on_topic' || f?.recall_policy === 'manual_only' || f?.recall_policy === 'never'
          ? f.recall_policy
          : undefined
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

async function extractWithPrompt(systemPrompt: string, source: string, maxTokens = 3000): Promise<MemoryExtraction> {
  const provider = getActiveProvider();
  if (!provider) throw new Error('尚未配置 API provider, 无法整理记忆');
  const resp = await providerChat(provider, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: source }
    ],
    maxTokens,
    temperature: 0
  });
  try {
    return normalizeExtraction(JSON.parse(cleanJsonText(resp.text ?? '')));
  } catch (e: any) {
    throw new Error(`记忆整理器返回了无效 JSON: ${e?.message ?? String(e)}`);
  }
}

function episodePairSource(input: { userEpisode: EpisodeRow; assistantEpisode?: EpisodeRow; personaId: string; triggerKind?: string }): string {
  return [
    `persona_id: ${input.personaId}`,
    input.triggerKind ? `trigger_kind: ${input.triggerKind}` : '',
    `user episode #${input.userEpisode.id}: ${input.userEpisode.content}`,
    input.assistantEpisode
      ? `assistant episode #${input.assistantEpisode.id}: ${input.assistantEpisode.content}`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

const JSON_SCHEMA_PROMPT = 'JSON schema: {"importance":0..1,"summary":{"should_create":boolean,"title":string,"kind":string,"summary":string,"keywords":string[],"entities":string[]},"facts":[{"predicate":"lower_snake_key","subject":"user","object":string,"confidence":0..1,"cardinality":"single|set","scope":"global|persona|project","recall_policy":"always|on_topic|manual_only|never"}],"entities":[{"name":string,"type":string,"aliases":string[]}],"relations":[{"subject":string,"subject_type":string,"predicate":string,"object":string,"object_type":string,"qualifier":string,"confidence":0..1,"importance":0..1}],"decisions":[{"title":string,"decision":string,"reason":string,"alternatives_rejected":string[],"confidence":0..1}]}';

export async function extractMemoryFromEpisodePair(input: {
  userEpisode: EpisodeRow;
  assistantEpisode?: EpisodeRow;
  personaId: string;
}): Promise<MemoryExtraction> {
  return extractWithPrompt(
    `你是 reader-pet 的长期记忆整理器。只输出严格 JSON, 不要 markdown。只抽取长期有用且能由原文支持的记忆: 用户偏好、伴侣连续性、项目决策、创作世界观、工具任务结果、边界和来源可追溯内容。不要记录玩笑、假设、短期寒暄、临时情绪, 不要编造。事实 cardinality: single 表示同 predicate+subject+scope 只能有一个当前值; set 表示可同时存在多个值。事实 scope: global=跨人格都应知道的稳定用户事实; persona=当前人格专属关系、称呼、互动偏好或共同经历; project=明确代码/项目决策, 没有清楚项目上下文时不要用 project。recall_policy: always=基础档案/重要边界; on_topic=相关时召回; manual_only=只供用户手动查看; never=保留但不主动召回。${JSON_SCHEMA_PROMPT}`,
    episodePairSource(input)
  );
}

export async function extractImportantMemoryFromEpisodePair(input: {
  userEpisode: EpisodeRow;
  assistantEpisode?: EpisodeRow;
  personaId: string;
  triggerKind: string;
}): Promise<MemoryExtraction> {
  const extraction = await extractWithPrompt(
    `你是 reader-pet 的重大记忆即时整理器。只输出严格 JSON, 不要 markdown。输入是一轮被本地规则判定为重要的 user/assistant episode。只处理明确会影响未来多次互动的内容: 用户明确要求记住/别忘、称呼变化、边界和禁忌、纠正已有记忆、长期偏好、安全或权限规则、关系定位。不要把临时情绪、玩笑、一次性任务、角色扮演台词、模型自己编出的共同经历写成长期事实。summary 可以很短; facts 最多 3 条, 必须高置信、来源明确、可复用。称呼/边界/安全规则 recall_policy 通常用 always; 普通偏好用 on_topic。scope: global=跨人格稳定用户事实; persona=当前人格专属称呼/关系/共同经历; project=明确项目决策。${JSON_SCHEMA_PROMPT}`,
    episodePairSource(input),
    2200
  );
  if (extraction.summary) extraction.summary.kind = 'important_digest';
  extraction.facts = extraction.facts.filter((fact) => fact.confidence >= 0.72).slice(0, 3);
  return extraction;
}

export async function extractDailyDigestFromEpisodes(input: {
  personaId: string;
  localDay: string;
  episodes: EpisodeRow[];
}): Promise<MemoryExtraction> {
  const source = [
    `persona_id: ${input.personaId}`,
    `local_day: ${input.localDay}`,
    ...input.episodes.map((episode) => `${episode.role} episode #${episode.id} @ ${new Date(episode.ts).toLocaleString()}: ${episode.content}`)
  ].join('\n\n');
  const extraction = await extractWithPrompt(
    `你是 reader-pet 的日记式记忆整理器。只输出严格 JSON, 不要 markdown。输入是一段按 episode id 连续的对话历史。summary 应像日记一样概括这段时间值得保留的对话、项目进展、关系/边界/偏好变化和重要上下文, 可以比 facts 稍宽。facts 必须非常保守: 只保存稳定、可复用、未来回应会受影响的事实; 不要把普通流水、临时情绪、一次性报错、寒暄或假设写成 fact。低置信内容只放 summary, 不写 fact。summary.kind 必须是 daily_digest。${JSON_SCHEMA_PROMPT}`,
    source,
    3500
  );
  if (extraction.summary) extraction.summary.kind = 'daily_digest';
  extraction.facts = extraction.facts.filter((fact) => fact.confidence >= 0.82).slice(0, 4);
  return extraction;
}
