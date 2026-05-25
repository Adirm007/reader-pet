import { getConfig } from '../config';
import {
  claimNextMemoryJob,
  enqueueMemoryJob,
  updateMemoryJob
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
  if (getConfig().memory.digestionEnabled) kickMemoryWorker();
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
      const job = claimNextMemoryJob(['digest_episode_pair', 'graph_sync_summary']);
      if (!job) break;
      try {
        await processMemoryJob(job);
      } catch (e: any) {
        updateMemoryJob(job.id, {
          status: 'failed',
          finished_at: Date.now(),
          error: e?.message ?? String(e)
        });
      }
    }
  } finally {
    running = false;
  }
}
