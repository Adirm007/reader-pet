import { getConfig } from '../config';
import {
  claimNextMemoryJob,
  enqueueMemoryJob,
  failOrRetryMemoryJob,
  recoverStaleMemoryJobs
} from './store';
import { processMemoryJob } from './digestion';

let running = false;
let stopped = true;
let timer: NodeJS.Timeout | null = null;

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

export function kickMemoryWorker() {
  if (stopped || running) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runWorkerLoop();
  }, 10);
}

async function runWorkerLoop() {
  if (stopped || running) return;
  running = true;
  try {
    while (!stopped) {
      const job = claimNextMemoryJob(['digest_episode_pair', 'graph_sync_summary', 'embed_memory_item', 'embed_missing_memories']);
      if (!job) break;
      try {
        await processMemoryJob(job);
      } catch (e: any) {
        const message = e?.message ?? String(e);
        const retryable = !/not found|不存在|unsupported|不支持|payload|JSON/i.test(message);
        failOrRetryMemoryJob(job, message, retryable);
      }
    }
  } finally {
    running = false;
  }
}
