import type { CapabilityStatus, McpServerConfig } from '../../shared/types';
import { getConfig } from '../config';
import { checkMcp } from '../permissions';
import { McpClient } from './mcp-client';

const clients = new Map<string, McpClient>();

function enabledServers(): McpServerConfig[] {
  return getConfig().mcp.servers.filter((server) => server.enabled);
}

function findServer(id: string): McpServerConfig {
  const server = enabledServers().find((item) => item.id === id);
  if (!server) throw new Error(`未找到已启用的 MCP server: ${id}`);
  if (!server.command.trim()) throw new Error(`MCP server ${id} 未配置命令`);
  return server;
}

function clientFor(server: McpServerConfig): McpClient {
  const existing = clients.get(server.id);
  if (existing) return existing;
  const client = new McpClient({
    id: server.id,
    command: server.command,
    args: server.args,
    cwd: server.cwd
  });
  clients.set(server.id, client);
  return client;
}

export function listMcpServers(): Array<{ id: string; displayName: string; riskLevel: string; enabled: boolean }> {
  const decision = checkMcp();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  return getConfig().mcp.servers.map((server) => ({
    id: server.id,
    displayName: server.displayName,
    riskLevel: server.riskLevel,
    enabled: server.enabled
  }));
}

export async function listMcpTools(serverId: string): Promise<any[]> {
  const decision = checkMcp();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  const server = findServer(serverId);
  return clientFor(server).listTools();
}

export async function callMcpTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const decision = checkMcp();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  const server = findServer(serverId);
  return clientFor(server).callTool(toolName, args ?? {});
}

export function getMcpStatus(): CapabilityStatus {
  const cfg = getConfig();
  if (cfg.safetyMode === 'safe') return { id: 'mcp', status: 'blocked', message: '仅危险模式可用' };
  if (!cfg.capabilities.mcpEnabled) return { id: 'mcp', status: 'disabled', message: '未启用 MCP 插件' };
  const count = enabledServers().filter((server) => server.command.trim()).length;
  return count > 0
    ? { id: 'mcp', status: 'available', message: `已配置 ${count} 个已启用 server` }
    : { id: 'mcp', status: 'disabled', message: '未配置已启用的 MCP server' };
}

export async function stopMcpServers(): Promise<void> {
  const stops = Array.from(clients.values()).map((client) => client.stop());
  clients.clear();
  await Promise.all(stops);
}
