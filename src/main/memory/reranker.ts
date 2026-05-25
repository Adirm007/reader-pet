import { getConfig } from '../config';

export interface RerankCandidate<T> {
  item: T;
  text: string;
  score?: number;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function parseRerankResults(data: any): Array<{ index: number; score: number }> {
  const raw = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data)
        ? data
        : [];
  return raw
    .map((row: any, fallbackIndex: number) => ({
      index: Number.isFinite(Number(row?.index))
        ? Number(row.index)
        : Number.isFinite(Number(row?.document?.index))
          ? Number(row.document.index)
          : fallbackIndex,
      score: Number(row?.relevance_score ?? row?.score ?? row?.rerank_score ?? row?.similarity ?? 0)
    }))
    .filter((row: { index: number; score: number }) => Number.isFinite(row.index) && Number.isFinite(row.score));
}

export async function rerankCandidates<T>(query: string, candidates: Array<RerankCandidate<T>>): Promise<Array<RerankCandidate<T> & { rerankScore?: number }>> {
  const cfg = getConfig().memory;
  if (!cfg.rerankEnabled || !cfg.rerankUrl.trim() || candidates.length <= 1) {
    return candidates;
  }
  const url = trimSlash(cfg.rerankUrl.trim());
  const documents = candidates.map((candidate) => candidate.text.slice(0, 1600));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.rerankApiKey.trim()) headers.Authorization = `Bearer ${cfg.rerankApiKey.trim()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.rerankModel.trim() || undefined,
      query,
      documents,
      top_n: Math.min(cfg.rerankTopK || candidates.length, candidates.length),
      return_documents: false
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reranker HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  const results = parseRerankResults(data);
  if (!results.length) return candidates;
  const byIndex = new Map(results.map((row) => [row.index, row.score]));
  const minScore = Number.isFinite(cfg.rerankMinScore) ? cfg.rerankMinScore : 0;
  return candidates
    .map((candidate, index) => ({ ...candidate, rerankScore: byIndex.get(index) }))
    .filter((candidate) => candidate.rerankScore === undefined || candidate.rerankScore >= minScore)
    .sort((a, b) => (b.rerankScore ?? b.score ?? 0) - (a.rerankScore ?? a.score ?? 0))
    .slice(0, Math.min(cfg.rerankTopK || candidates.length, candidates.length));
}
