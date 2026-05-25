import neo4j, { Driver } from 'neo4j-driver';
import { getConfig } from '../config';

let driver: Driver | null = null;
let driverKey = '';

function getDriver(): Driver {
  const cfg = getConfig().memory;
  if (!cfg.graphEnabled) throw new Error('Neo4j 图谱记忆未启用');
  if (!cfg.neo4jUri.trim()) throw new Error('Neo4j URI 为空');
  const key = `${cfg.neo4jUri}\n${cfg.neo4jUser}\n${cfg.neo4jPassword}`;
  if (driver && key === driverKey) return driver;
  if (driver) void driver.close();
  driver = neo4j.driver(
    cfg.neo4jUri.trim(),
    neo4j.auth.basic(cfg.neo4jUser.trim() || 'neo4j', cfg.neo4jPassword)
  );
  driverKey = key;
  return driver;
}

export async function runGraphQuery<T = any>(
  cypher: string,
  params?: Record<string, any>,
  timeoutMs?: number
): Promise<T[]> {
  const session = getDriver().session();
  try {
    const result = await session.run(cypher, params ?? {}, timeoutMs ? { timeout: timeoutMs } : undefined);
    return result.records.map((record) => record.toObject() as T);
  } finally {
    await session.close();
  }
}

export async function testGraphConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    await getDriver().verifyConnectivity();
    return { ok: true, message: 'Neo4j 连接成功' };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? String(e) };
  }
}

export async function getGraphStats(): Promise<{
  ok: boolean;
  nodes?: number;
  relationships?: number;
  message?: string;
}> {
  try {
    const rows = await runGraphQuery<{ nodes: any; relationships: any }>(
      `MATCH (n) WITH count(n) AS nodes MATCH ()-[r]->() RETURN nodes, count(r) AS relationships`
    );
    const row = rows[0];
    return {
      ok: true,
      nodes: Number(row?.nodes?.toNumber?.() ?? row?.nodes ?? 0),
      relationships: Number(row?.relationships?.toNumber?.() ?? row?.relationships ?? 0)
    };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? String(e) };
  }
}

export async function closeGraph() {
  if (driver) {
    await driver.close();
    driver = null;
    driverKey = '';
  }
}
