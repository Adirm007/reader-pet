import { getConfig } from '../config';
import { listConversationSummaries, listFacts, listRecallableTasks, searchEpisodes } from './store';
import { recallGraphContext } from './graph';

const RECALL_TRIGGERS = [
  '之前',
  '以前',
  '还记得',
  '当时',
  '我们说过',
  '为什么',
  '那个方案',
  '你记不记得',
  '上次',
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

function shouldRecall(input: string): boolean {
  return RECALL_TRIGGERS.some((term) => input.includes(term));
}

function shouldRecallTasks(input: string): boolean {
  return TASK_RECALL_TRIGGERS.some((term) => input.includes(term));
}

function compactQuery(input: string): string {
  return input.replace(/[?？。！!，,、]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function buildMemoryContext(input: { userInput: string; personaId: string }): Promise<{
  facts: Array<{ predicate: string; object: string }>;
  recentTasks: Array<{ ts: number; summary?: string }>;
  block: string;
}> {
  let facts: Array<{ predicate: string; object: string }> = [];
  let recentTasks: Array<{ ts: number; summary?: string }> = [];
  try {
    facts = listFacts({ status: 'active', limit: 30 }).map((f) => ({ predicate: f.predicate, object: f.object }));
  } catch {
    facts = [];
  }
  try {
    const query = compactQuery(input.userInput);
    const tasks = shouldRecallTasks(input.userInput)
      ? listRecallableTasks({ query, limit: 5 })
      : listRecallableTasks({ limit: 3, alwaysOnly: true });
    recentTasks = tasks
      .filter((t) => t.summary?.trim())
      .map((t) => ({ ts: t.ts, summary: t.summary }));
  } catch {
    recentTasks = [];
  }

  const cfg = getConfig().memory;
  if (!cfg.graphRecallEnabled || !shouldRecall(input.userInput)) {
    return { facts, recentTasks, block: '' };
  }

  const query = compactQuery(input.userInput);
  const lines: string[] = [];
  try {
    const hits = await recallGraphContext({ query, limit: 8, timeoutMs: cfg.graphRecallTimeoutMs });
    if (hits.length) {
      lines.push('### 图谱关系');
      lines.push(...hits.slice(0, 8).map((hit) => `- ${hit.text}`));
    }
  } catch {
    /* ignore */
  }
  try {
    const summaries = listConversationSummaries({ query, limit: 5 });
    if (summaries.length) {
      lines.push('### 重要对话摘要');
      lines.push(
        ...summaries.map(
          (s) => `- #${s.id} ${s.title}: ${s.summary.slice(0, 240)} (episode ${s.episode_start_id ?? '?'}-${s.episode_end_id ?? '?'})`
        )
      );
    }
  } catch {
    /* ignore */
  }
  try {
    const episodes = searchEpisodes(query, 3);
    if (episodes.length) {
      lines.push('### 原始对话片段');
      lines.push(...episodes.map((e) => `- episode #${e.id} ${e.role}: ${e.content.slice(0, 220)}`));
    }
  } catch {
    /* ignore */
  }

  return { facts, recentTasks, block: lines.join('\n') };
}
