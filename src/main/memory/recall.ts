import { getConfig } from '../config';
import {
  getConversationSummaryById,
  getDbFactById,
  listFacts,
  listRecallableConversationSummaries,
  listRecallableTasks,
  searchEpisodes
} from './store';
import { recallGraphContext } from './graph';
import { searchVectorMemories } from './embeddings';
import { rerankCandidates } from './reranker';

const RECALL_TRIGGERS = [
  '之前',
  '以前',
  '还记得',
  '当时',
  '我们说过',
  '我说过',
  '为什么',
  '那个方案',
  '那个记忆',
  '你记不记得',
  '上次',
  '昨天',
  '继续那个',
  '记忆',
  '决定',
  '原因'
];

const TASK_RECALL_TRIGGERS = [
  '任务',
  'Claude Code',
  '代码',
  '项目',
  '实现',
  '修复',
  'bug',
  '架构',
  '上次做',
  '刚才做',
  '工作记录',
  '任务记录'
];

const PERSONAL_TRIGGERS = ['我喜欢', '我不喜欢', '我的偏好', '我的设定', '我的项目', '我最近', '我现在', '我是谁', '你知道我'];
const CASUAL_SHORT = ['嗯', '哦', '好', '行', '可以', '谢谢', '早', '晚安', '你好'];

function includesAny(input: string, terms: string[]): boolean {
  return terms.some((term) => input.includes(term));
}

function compactQuery(input: string): string {
  return input.replace(/[?？。！!，,、]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function analyzeRecallIntent(input: string) {
  const trimmed = input.trim();
  const explicitRecall = includesAny(trimmed, RECALL_TRIGGERS);
  const taskLike = includesAny(trimmed, TASK_RECALL_TRIGGERS);
  const personalFactLike = includesAny(trimmed, PERSONAL_TRIGGERS);
  const casualSmallTalk = trimmed.length <= 8 && CASUAL_SHORT.some((term) => trimmed === term || trimmed.startsWith(term));
  return {
    query: compactQuery(trimmed),
    explicitRecall,
    taskLike,
    personalFactLike,
    casualSmallTalk,
    shouldUseDeepRecall: explicitRecall || taskLike || personalFactLike || (!casualSmallTalk && trimmed.length >= 12)
  };
}

export async function buildMemoryContext(input: { userInput: string; personaId: string }): Promise<{
  facts: Array<{ predicate: string; object: string }>;
  recentTasks: Array<{ ts: number; summary?: string }>;
  block: string;
}> {
  const intent = analyzeRecallIntent(input.userInput);
  const cfg = getConfig().memory;
  const factMap = new Map<number | string, { predicate: string; object: string }>();
  let recentTasks: Array<{ ts: number; summary?: string }> = [];
  const lines: string[] = [];
  const summaryIds = new Set<number>();

  try {
    for (const f of listFacts({ status: 'active', limit: 12 })) {
      factMap.set(f.id, { predicate: f.subject === 'user' ? f.predicate : `${f.subject}.${f.predicate}`, object: f.object });
    }
  } catch {
    /* ignore */
  }

  try {
    const tasks = intent.taskLike
      ? listRecallableTasks({ query: intent.query, limit: 5 })
      : listRecallableTasks({ limit: 3, alwaysOnly: true });
    recentTasks = tasks
      .filter((t) => t.summary?.trim())
      .slice(0, 3)
      .map((t) => ({ ts: t.ts, summary: t.summary }));
  } catch {
    recentTasks = [];
  }

  if (intent.shouldUseDeepRecall) {
    try {
      const vectorHits = await searchVectorMemories(intent.query, {
        limit: cfg.vectorRecallLimit,
        minScore: cfg.vectorMinScore
      });
      const candidates = vectorHits.map((hit) => ({
        item: hit,
        text: hit.text ?? '',
        score: hit.score
      }));
      const reranked = await rerankCandidates(intent.query, candidates);
      const vectorLines: string[] = [];
      for (const candidate of reranked) {
        const hit = candidate.item;
        const scoreText = candidate.rerankScore !== undefined
          ? `rerank ${candidate.rerankScore.toFixed(2)}, vec ${hit.score.toFixed(2)}`
          : `vec ${hit.score.toFixed(2)}`;
        if (hit.memoryType === 'fact') {
          const fact = getDbFactById(hit.memoryId);
          if (fact?.status === 'active') {
            factMap.set(fact.id, { predicate: fact.subject === 'user' ? fact.predicate : `${fact.subject}.${fact.predicate}`, object: fact.object });
            vectorLines.push(`- fact #${fact.id} (${scoreText}) ${fact.subject}.${fact.predicate}: ${fact.object}`);
          }
        } else {
          const summary = getConversationSummaryById(hit.memoryId);
          if (summary && (summary.status ?? 'active') === 'active' && summary.recall_policy !== 'never' && summary.recall_policy !== 'manual_only' && !summaryIds.has(summary.id)) {
            summaryIds.add(summary.id);
            vectorLines.push(`- summary #${summary.id} (${scoreText}) ${summary.title}: ${summary.summary.slice(0, 220)}`);
          }
        }
      }
      if (vectorLines.length) {
        lines.push('### 相关长期记忆');
        lines.push(...vectorLines.slice(0, 8));
      }
    } catch {
      /* ignore */
    }
  }

  try {
    const summaries = intent.shouldUseDeepRecall
      ? listRecallableConversationSummaries({ query: intent.query, limit: 5 })
      : listRecallableConversationSummaries({ limit: 3, alwaysOnly: true });
    const summaryLines = summaries
      .filter((s) => !summaryIds.has(s.id))
      .slice(0, 5)
      .map((s) => {
        summaryIds.add(s.id);
        return `- summary #${s.id} ${s.title}: ${s.summary.slice(0, 240)} (episode ${s.episode_start_id ?? '?'}-${s.episode_end_id ?? '?'})`;
      });
    if (summaryLines.length) {
      if (!lines.includes('### 相关长期记忆')) lines.push('### 相关长期记忆');
      lines.push(...summaryLines);
    }
  } catch {
    /* ignore */
  }

  if (cfg.graphEnabled && cfg.graphRecallEnabled && (intent.explicitRecall || intent.personalFactLike || intent.taskLike)) {
    try {
      const hits = await recallGraphContext({ query: intent.query, limit: 5, timeoutMs: cfg.graphRecallTimeoutMs });
      if (hits.length) {
        lines.push('### 图谱关系');
        lines.push(...hits.slice(0, 5).map((hit) => `- ${hit.text}`));
      }
    } catch {
      /* ignore */
    }
  }

  if (intent.explicitRecall) {
    try {
      const episodes = searchEpisodes(intent.query, 2);
      if (episodes.length) {
        lines.push('### 可引用的历史片段');
        lines.push(...episodes.map((e) => `- episode #${e.id} ${e.role}: ${e.content.slice(0, 220)}`));
      }
    } catch {
      /* ignore */
    }
  }

  return { facts: [...factMap.values()].slice(0, 18), recentTasks, block: lines.join('\n') };
}
