import type { CapabilityRuntimeStatus } from '../../shared/types';
import { getConfig } from '../config';
import { checkPlaywright } from '../permissions';
import { McpClient } from './mcp-client';

let client: McpClient | null = null;
let clientSignature = '';
let startedAt: number | undefined;
let lastError: string | undefined;

function configSignature(): string {
  const cfg = getConfig();
  return JSON.stringify({
    command: cfg.automation.playwrightMcpCommand,
    args: cfg.automation.playwrightMcpArgs,
    cwd: cfg.automation.playwrightMcpCwd || ''
  });
}

async function resetIfConfigChanged(signature: string): Promise<void> {
  if (!client || clientSignature === signature) return;
  await stopBrowserMcp();
}

async function getClient(): Promise<McpClient> {
  const cfg = getConfig();
  if (!cfg.automation.playwrightMcpCommand.trim()) {
    throw new Error('未配置 Playwright MCP 命令. 请在 automation.playwrightMcpCommand 中填写本地命令.');
  }
  const signature = configSignature();
  await resetIfConfigChanged(signature);
  if (!client) {
    client = new McpClient({
      id: 'playwright',
      command: cfg.automation.playwrightMcpCommand,
      args: cfg.automation.playwrightMcpArgs,
      cwd: cfg.automation.playwrightMcpCwd || undefined
    });
    clientSignature = signature;
    startedAt = Date.now();
    lastError = undefined;
  }
  return client;
}

export function isPlaywrightMcpConfigured(): boolean {
  return !!getConfig().automation.playwrightMcpCommand.trim();
}

export async function listBrowserMcpTools(): Promise<any[]> {
  const decision = checkPlaywright();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  try {
    return await (await getClient()).listTools();
  } catch (e: any) {
    lastError = e?.message ?? String(e);
    throw e;
  }
}

export async function callBrowserMcpTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const decision = checkPlaywright();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  try {
    return await (await getClient()).callTool(toolName, args ?? {});
  } catch (e: any) {
    lastError = e?.message ?? String(e);
    throw e;
  }
}

export async function browserMcpGoto(url: string): Promise<{ ok: boolean; url: string; title: string; text: string }> {
  const tools = await listBrowserMcpTools();
  const names = tools.map((tool) => String(tool.name));
  const navigateTool = names.find((name) => ['browser_navigate', 'navigate', 'browser.goto'].includes(name));
  if (!navigateTool) {
    throw new Error(`Playwright MCP 未暴露导航工具. 可用工具=${names.join(', ')}`);
  }
  await callBrowserMcpTool(navigateTool, { url });

  const titleTool = names.find((name) => ['browser_title', 'title'].includes(name));
  const snapshotTool = names.find((name) => ['browser_snapshot', 'snapshot', 'browser_get_text', 'browser_text'].includes(name));
  const titleResult = titleTool ? await callBrowserMcpTool(titleTool, {}) : null;
  const snapshotResult = snapshotTool ? await callBrowserMcpTool(snapshotTool, {}) : null;

  return {
    ok: true,
    url,
    title: extractText(titleResult).slice(0, 500),
    text: extractText(snapshotResult).slice(0, 8000)
  };
}

export function getBrowserMcpRuntimeStatus(): CapabilityRuntimeStatus {
  return {
    id: 'browser',
    running: !!client?.isRunning(),
    detail: client?.isRunning() ? 'Playwright MCP client' : undefined,
    startedAt,
    lastError
  };
}

export async function stopBrowserMcp(): Promise<void> {
  await client?.stop();
  client = null;
  clientSignature = '';
  startedAt = undefined;
}

function extractText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const content = (value as any).content;
  if (Array.isArray(content)) {
    return content.map((item) => item?.text ?? JSON.stringify(item)).join('\n');
  }
  return JSON.stringify(value);
}
