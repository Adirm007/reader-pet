import type { BrowserWindow } from 'electron';
import { getConfig } from '../config';
import {
  claimNextMemoryJob,
  enqueueMemoryJob,
  failOrRetryMemoryJob,
  findUncoveredRanges,
  getEpisodeBoundsForLocalDay,
  listDailyDigestCoverage,
  nextPendingMemoryJobRunAt,
  recoverStaleMemoryJobs
} from './store';

function localDateString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function countRangeEpisodes(range: { episodeStartId: number; episodeEndId: number }): number {
  return Math.max(0, range.episodeEndId - range.episodeStartId + 1);
}
import { processMemoryJob } from './digestion';

export type ImportantTriggerKind =
  | 'explicit_remember'
  | 'boundary'
  | 'correction'
  | 'addressing'
  | 'relationship'
  | 'preference'
  | 'safety_rule'
  | 'important_marker';

const TRANSIENT_PATTERNS = [
  /以后(再说|有空|看看|试试|再看|再弄)/,
  /(暂时|这次先|今天先|这轮|这一轮|开玩笑|假设)/
];

export function detectImportantTrigger(text: string): ImportantTriggerKind | null {
  const input = text.trim();
  if (!input) return null;
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(input))) {
    if (!/(记住|别忘|不要再|别再|你记错了|这很重要|叫我|不要叫我|边界|安全规则)/.test(input)) return null;
  }
  if (/(安全规则|权限规则|必须|禁止|不能|不要自动|危险操作|二次确认|不要.*push|不要.*删除)/.test(input)) return 'safety_rule';
  if (/(不要再|别再|不要提|别提|边界|禁忌|不希望.*再|以后不要)/.test(input)) return 'boundary';
  if (/(你记错了|记错了|更正一下|纠正一下|不是.+是.+)/.test(input)) return 'correction';
  if (/(以后叫我|叫我|不要叫我|别叫我|称呼)/.test(input)) return 'addressing';
  if (/(关系定位|不是恋人|不是工具|你是我的|我是你的|我们之间|把自己当成)/.test(input)) return 'relationship';
  if (/(我不喜欢|我喜欢|我讨厌|我更喜欢|我希望你|我想让你|以后.*默认|默认.*)/.test(input)) return 'preference';
  if (/(记住|记一下|你要记得|帮我记|别忘|不要忘|以后都|从现在开始|设定为|改成)/.test(input)) return 'explicit_remember';
  if (/(这很重要|这个很重要|这点保留|这对我很重要)/.test(input)) return 'important_marker';
  return null;
}

const MEMORY_JOB_TYPES = [
  'digest_important_episode_pair',
  'digest_diary_range',
  'digest_episode_pair',
  'graph_sync_summary',
  'graph_delete_summary',
  'graph_retract_fact',
  'graph_delete_fact',
  'graph_rebuild_all',
  'embed_memory_item',
  'embed_missing_memories'
];

let running = false;
let stopped = true;
let timer: NodeJS.Timeout | null = null;
let getPetWindow: () => BrowserWindow | null = () => null;
let lastFailureNoticeAt = 0;

export function setMemoryJobPetWindowGetter(fn: () => BrowserWindow | null) {
  getPetWindow = fn;
}

function notifyMemoryJobFailure(jobType: string, error: string) {
  const now = Date.now();
  if (now - lastFailureNoticeAt < 60_000) return;
  lastFailureNoticeAt = now;
  const win = getPetWindow();
  if (!win || win.isDestroyed()) return;
  const shortError = error.replace(/\s+/g, ' ').slice(0, 180);
  win.webContents.send('pet:bubble', {
    text: `记忆后台任务 ${jobType} 重试后仍失败：${shortError}`,
    kind: 'memory-error',
    ts: now
  });
  if (!win.isVisible()) win.show();
}

export function enqueueDigestEpisodePair(input: {
  userEpisodeId: number;
  assistantEpisodeId?: number;
  personaId: string;
}): number {
  return enqueueMemoryJob({
    type: 'digest_episode_pair',
    dedupe_key: `digest_episode_pair:${input.userEpisodeId}:${input.assistantEpisodeId ?? 'none'}`,
    payload_json: JSON.stringify(input)
  });
}

export function enqueueDigestImportantEpisodePair(input: {
  userEpisodeId: number;
  assistantEpisodeId: number;
  personaId: string;
  triggerKind: ImportantTriggerKind;
}): number {
  return enqueueMemoryJob({
    type: 'digest_important_episode_pair',
    dedupe_key: `digest_important_episode_pair:${input.personaId}:${input.userEpisodeId}:${input.assistantEpisodeId}`,
    payload_json: JSON.stringify(input)
  });
}

export function enqueueDigestDiaryRange(input: {
  personaId: string;
  localDay: string;
  episodeStartId: number;
  episodeEndId: number;
}): number {
  return enqueueMemoryJob({
    type: 'digest_diary_range',
    dedupe_key: `digest_diary_range:${input.personaId}:${input.localDay}:${input.episodeStartId}:${input.episodeEndId}`,
    payload_json: JSON.stringify(input)
  });
}

export function enqueueMissingDailyDigests(input: {
  personaId: string;
  localDay: string;
  maxEpisodesPerRange?: number;
}): { enqueued: number; uncoveredEpisodes: number; ranges: Array<{ episodeStartId: number; episodeEndId: number }> } {
  const bounds = getEpisodeBoundsForLocalDay({ personaId: input.personaId, localDay: input.localDay });
  if (!bounds) return { enqueued: 0, uncoveredEpisodes: 0, ranges: [] };
  const covered = listDailyDigestCoverage({
    personaId: input.personaId,
    episodeStartId: bounds.episodeStartId,
    episodeEndId: bounds.episodeEndId
  });
  const gaps = findUncoveredRanges(bounds.episodeStartId, bounds.episodeEndId, covered);
  const uncoveredEpisodes = gaps.reduce((sum, range) => sum + countRangeEpisodes(range), 0);
  const ranges = splitDigestRanges(gaps, input.maxEpisodesPerRange);
  const enqueued = enqueueDigestRanges(input.personaId, input.localDay, ranges);
  return { enqueued, uncoveredEpisodes, ranges };
}

function splitDigestRanges(
  gaps: Array<{ episodeStartId: number; episodeEndId: number }>,
  maxEpisodesPerRange?: number
): Array<{ episodeStartId: number; episodeEndId: number }> {
  const maxEpisodes = Math.max(2, Math.floor(maxEpisodesPerRange ?? 60));
  const ranges: Array<{ episodeStartId: number; episodeEndId: number }> = [];
  for (const gap of gaps) {
    for (let start = gap.episodeStartId; start <= gap.episodeEndId; start += maxEpisodes) {
      ranges.push({ episodeStartId: start, episodeEndId: Math.min(gap.episodeEndId, start + maxEpisodes - 1) });
    }
  }
  return ranges;
}

function enqueueDigestRanges(
  personaId: string,
  localDay: string,
  ranges: Array<{ episodeStartId: number; episodeEndId: number }>
): number {
  let enqueued = 0;
  for (const range of ranges) {
    const jobId = enqueueDigestDiaryRange({
      personaId,
      localDay,
      episodeStartId: range.episodeStartId,
      episodeEndId: range.episodeEndId
    });
    if (jobId) enqueued += 1;
  }
  return enqueued;
}

export function enqueueMissingDailyDigestsForRecentDays(input: {
  personaId: string;
  lookbackDays: number;
  maxEpisodesPerRange?: number;
  minUncoveredEpisodes?: number;
}): { enqueued: number; uncoveredEpisodes: number; ranges: Array<{ localDay: string; episodeStartId: number; episodeEndId: number }> } {
  const lookbackDays = Math.max(1, Math.min(365, Math.floor(input.lookbackDays)));
  const allRanges: Array<{ localDay: string; episodeStartId: number; episodeEndId: number }> = [];
  let uncoveredEpisodes = 0;
  for (let offset = 0; offset > -lookbackDays; offset--) {
    const localDay = localDateString(offset);
    const bounds = getEpisodeBoundsForLocalDay({ personaId: input.personaId, localDay });
    if (!bounds) continue;
    const covered = listDailyDigestCoverage({
      personaId: input.personaId,
      episodeStartId: bounds.episodeStartId,
      episodeEndId: bounds.episodeEndId
    });
    const gaps = findUncoveredRanges(bounds.episodeStartId, bounds.episodeEndId, covered);
    uncoveredEpisodes += gaps.reduce((sum, range) => sum + countRangeEpisodes(range), 0);
    for (const range of splitDigestRanges(gaps, input.maxEpisodesPerRange)) {
      allRanges.push({ localDay, ...range });
    }
  }
  if (input.minUncoveredEpisodes !== undefined && uncoveredEpisodes < input.minUncoveredEpisodes) {
    return { enqueued: 0, uncoveredEpisodes, ranges: allRanges };
  }
  let enqueued = 0;
  for (const range of allRanges) {
    const jobId = enqueueDigestDiaryRange({
      personaId: input.personaId,
      localDay: range.localDay,
      episodeStartId: range.episodeStartId,
      episodeEndId: range.episodeEndId
    });
    if (jobId) enqueued += 1;
  }
  return { enqueued, uncoveredEpisodes, ranges: allRanges };
}

export function startMemoryWorker() {
  stopped = false;
  recoverStaleMemoryJobs();
  if (getConfig().memory.digestionEnabled || getConfig().memory.embeddingEnabled) kickMemoryWorker();
}

export function stopMemoryWorker() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

export function kickMemoryWorker(delayMs = 10) {
  if (stopped || running) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runWorkerLoop();
  }, Math.max(10, delayMs));
}

function scheduleNextPendingJob() {
  const nextRunAt = nextPendingMemoryJobRunAt(MEMORY_JOB_TYPES);
  if (nextRunAt === undefined) return;
  const delayMs = Math.max(10, nextRunAt - Date.now());
  kickMemoryWorker(delayMs);
}

async function runWorkerLoop() {
  if (stopped || running) return;
  running = true;
  try {
    while (!stopped) {
      const job = claimNextMemoryJob(MEMORY_JOB_TYPES);
      if (!job) break;
      try {
        await processMemoryJob(job);
      } catch (e: any) {
        const message = e?.message ?? String(e);
        const retryable = !/not found|不存在|unsupported|不支持|payload|JSON/i.test(message);
        const result = failOrRetryMemoryJob(job, message, retryable);
        if (result.status === 'failed') notifyMemoryJobFailure(job.type, message);
      }
    }
  } finally {
    running = false;
    if (!stopped) scheduleNextPendingJob();
  }
}
