import type { CapabilityRuntimeStatus, CapabilityStatus, McpServerConfig } from '../../shared/types';
import { getConfig } from '../config';
import { checkMcp } from '../permissions';
import { McpClient } from './mcp-client';

const clients = new Map<string, McpClient>();
const clientSignatures = new Map<string, string>();
const clientStartedAt = new Map<string, number>();
const clientLastErrors = new Map<string, string>();

function serverSignature(server: McpServerConfig): string {
  return JSON.stringify({
    transport: server.transport ?? 'stdio',
    command: server.command,
    args: server.args,
    cwd: server.cwd || '',
    url: server.url || '',
    headers: server.headers ?? {}
  });
}

function enabledServers(): McpServerConfig[] {
  return getConfig().mcp.servers.filter((server) => server.enabled);
}

function findServer(id: string): McpServerConfig {
  const server = enabledServers().find((item) => item.id === id);
  if (!server) throw new Error(`未找到已启用的 MCP server: ${id}`);
  if ((server.transport ?? 'stdio') === 'http') {
    if (!server.url?.trim()) throw new Error(`MCP HTTP server ${id} 未配置 URL`);
  } else if (!server.command.trim()) {
    throw new Error(`MCP server ${id} 未配置命令`);
  }
  return server;
}

async function clientFor(server: McpServerConfig): Promise<McpClient> {
  const signature = serverSignature(server);
  const existing = clients.get(server.id);
  if (existing && clientSignatures.get(server.id) === signature) return existing;
  if (existing) await stopMcpServer(server.id);
  const client = new McpClient({
    id: server.id,
    transport: server.transport ?? 'stdio',
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    url: server.url,
    headers: server.headers
  });
  clients.set(server.id, client);
  clientSignatures.set(server.id, signature);
  clientStartedAt.set(server.id, Date.now());
  clientLastErrors.delete(server.id);
  return client;
}

async function stopMcpServer(id: string): Promise<void> {
  const client = clients.get(id);
  clients.delete(id);
  clientSignatures.delete(id);
  clientStartedAt.delete(id);
  if (client) await client.stop();
}

export function listMcpServers(): Array<{ id: string; displayName: string; riskLevel: string; enabled: boolean; transport: string }> {
  const decision = checkMcp();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  return getConfig().mcp.servers.map((server) => ({
    id: server.id,
    displayName: server.displayName,
    riskLevel: server.riskLevel,
    enabled: server.enabled,
    transport: server.transport ?? 'stdio'
  }));
}

export async function listMcpTools(serverId: string): Promise<any[]> {
  return withMcpServer(serverId, (client) => client.listTools());
}

export async function callMcpTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const decision = checkMcp();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  const server = findServer(serverId);
  if (!server.allowAllTools && !(server.allowedTools ?? []).includes(toolName)) {
    throw new Error(`MCP tool 未在 allowlist 中: ${serverId}/${toolName}`);
  }
  try {
    return await (await clientFor(server)).callTool(toolName, args ?? {});
  } catch (e: any) {
    clientLastErrors.set(server.id, e?.message ?? String(e));
    throw e;
  }
}

export async function listMcpResources(serverId: string): Promise<any[]> {
  return withMcpServer(serverId, (client) => client.listResources());
}

export async function readMcpResource(serverId: string, uri: string): Promise<unknown> {
  return withMcpServer(serverId, (client) => client.readResource(uri));
}

export async function listMcpPrompts(serverId: string): Promise<any[]> {
  return withMcpServer(serverId, (client) => client.listPrompts());
}

export async function getMcpPrompt(serverId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  return withMcpServer(serverId, (client) => client.getPrompt(name, args ?? {}));
}

export function getMcpStatus(): CapabilityStatus {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe') return { id: 'mcp', status: 'blocked', message: '仅危险模式可用' };
  if (!cfg.capabilities.mcpEnabled) return { id: 'mcp', status: 'disabled', message: '未启用 MCP 插件' };
  const count = enabledServers().filter((server) => (server.transport ?? 'stdio') === 'http' ? server.url?.trim() : server.command.trim()).length;
  return count > 0
    ? { id: 'mcp', status: 'available', message: `已配置 ${count} 个已启用 server` }
    : { id: 'mcp', status: 'disabled', message: '未配置已启用的 MCP server' };
}

export function getMcpRuntimeStatus(): CapabilityRuntimeStatus {
  const running = Array.from(clients.entries()).filter(([, client]) => client.isRunning());
  const lastError = Array.from(clientLastErrors.entries()).map(([id, error]) => `${id}: ${error}`).join(' | ') || undefined;
  return {
    id: 'mcp',
    running: running.length > 0,
    detail: running.map(([id]) => id).join(', ') || undefined,
    startedAt: running.map(([id]) => clientStartedAt.get(id)).filter(Boolean).sort()[0],
    lastError
  };
}

export async function stopMcpServers(): Promise<void> {
  const ids = Array.from(clients.keys());
  await Promise.all(ids.map((id) => stopMcpServer(id)));
}

async function withMcpServer<T>(serverId: string, fn: (client: McpClient) => Promise<T>): Promise<T> {
  const decision = checkMcp();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  const server = findServer(serverId);
  try {
    return await fn(await clientFor(server));
  } catch (e: any) {
    clientLastErrors.set(server.id, e?.message ?? String(e));
    throw e;
  }
}
