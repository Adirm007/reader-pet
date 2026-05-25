import path from 'path';
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
  const safeUrl = validateHttpUrl(url);
  const tools = await listBrowserMcpTools();
  const names = toolNames(tools);
  const navigateTool = findToolName(names, ['browser_navigate', 'navigate', 'browser.goto']);
  if (!navigateTool) {
    throw missingToolError('导航', names);
  }
  await callBrowserMcpTool(navigateTool, { url: safeUrl });

  const titleTool = findToolName(names, ['browser_title', 'title']);
  const snapshotTool = findToolName(names, ['browser_snapshot', 'snapshot', 'browser_get_text', 'browser_text']);
  const titleResult = titleTool ? await callBrowserMcpTool(titleTool, {}) : null;
  const snapshotResult = snapshotTool ? await callBrowserMcpTool(snapshotTool, {}) : null;

  return {
    ok: true,
    url: safeUrl,
    title: extractText(titleResult).slice(0, 500),
    text: extractText(snapshotResult).slice(0, 8000)
  };
}

export async function browserMcpSnapshot(opts: { max_chars?: number } = {}): Promise<{ ok: boolean; text: string; truncated: boolean; used_tool: string }> {
  const maxChars = clampNumber(opts.max_chars, 12000, 1, 30000);
  const { usedTool, result } = await callResolvedBrowserTool(['browser_snapshot', 'snapshot', 'browser_get_text', 'browser_text'], {});
  const text = extractText(result);
  return { ok: true, text: text.slice(0, maxChars), truncated: text.length > maxChars, used_tool: usedTool };
}

export async function browserMcpClick(opts: {
  ref?: unknown;
  text?: unknown;
  button?: unknown;
  double_click?: unknown;
}): Promise<{ ok: boolean; used_tool: string; result: unknown }> {
  const ref = optionalString(opts.ref, 'ref', 200);
  const text = optionalString(opts.text, 'text', 300);
  if (!ref && !text) throw new Error('browser_click 需要 ref 或 text. 建议先调用 browser_snapshot 获取元素 ref.');
  const button = optionalString(opts.button, 'button', 20) || 'left';
  if (!['left', 'right', 'middle'].includes(button)) throw new Error('button 只能是 left/right/middle.');
  const aliases = opts.double_click ? ['browser_double_click', 'double_click'] : ['browser_click', 'click'];
  const args = ref ? { element: text || ref, ref, button } : { element: text, button };
  const { usedTool, result } = await callResolvedBrowserTool(aliases, args);
  return { ok: true, used_tool: usedTool, result: summarizeMcpResult(result, 4000) };
}

export async function browserMcpType(opts: {
  ref?: unknown;
  element?: unknown;
  text?: unknown;
  submit?: unknown;
}): Promise<{ ok: boolean; used_tool: string; typed_chars: number; submitted: boolean; result: unknown }> {
  const text = requireString(opts.text, 'text', 2000);
  const ref = optionalString(opts.ref, 'ref', 200);
  const element = optionalString(opts.element, 'element', 300) || ref;
  if (!ref && !element) throw new Error('browser_type 需要 ref 或 element. 建议先调用 browser_snapshot 获取输入框 ref.');
  const args = { element, ref, text, submit: opts.submit === true };
  const { usedTool, result } = await callResolvedBrowserTool(['browser_type', 'type', 'browser_fill', 'fill'], args);
  return { ok: true, used_tool: usedTool, typed_chars: text.length, submitted: opts.submit === true, result: summarizeMcpResult(result, 4000) };
}

export async function browserMcpPressKey(opts: { key?: unknown }): Promise<{ ok: boolean; used_tool: string; key: string; result: unknown }> {
  const key = requireString(opts.key, 'key', 40);
  if (!ALLOWED_KEYS.has(key)) {
    throw new Error(`不允许的浏览器按键: ${key}. 允许=${Array.from(ALLOWED_KEYS).join(', ')}`);
  }
  const { usedTool, result } = await callResolvedBrowserTool(['browser_press_key', 'press_key', 'keyboard_press'], { key });
  return { ok: true, used_tool: usedTool, key, result: summarizeMcpResult(result, 4000) };
}

export async function browserMcpWaitFor(opts: {
  text?: unknown;
  state?: unknown;
  timeout_ms?: unknown;
}): Promise<{ ok: boolean; used_tool: string; state: string; timeout_ms: number; result: unknown }> {
  const state = optionalString(opts.state, 'state', 20) || 'visible';
  if (!['visible', 'hidden', 'stable'].includes(state)) throw new Error('state 只能是 visible/hidden/stable.');
  const timeoutMs = clampNumber(opts.timeout_ms, 5000, 100, 30000);
  const text = optionalString(opts.text, 'text', 500);
  if (state !== 'stable' && !text) throw new Error('browser_wait_for 在 visible/hidden 状态下需要 text.');
  const args = state === 'stable' ? { timeout: timeoutMs, timeout_ms: timeoutMs } : { text, state, timeout: timeoutMs, timeout_ms: timeoutMs };
  const { usedTool, result } = await callResolvedBrowserTool(['browser_wait_for', 'wait_for'], args);
  return { ok: true, used_tool: usedTool, state, timeout_ms: timeoutMs, result: summarizeMcpResult(result, 4000) };
}

export async function browserMcpTakeScreenshot(opts: { full_page?: unknown } = {}): Promise<{ ok: boolean; used_tool: string; result: unknown }> {
  const { usedTool, result } = await callResolvedBrowserTool(['browser_take_screenshot', 'take_screenshot', 'screenshot'], {
    fullPage: opts.full_page === true,
    full_page: opts.full_page === true
  });
  return { ok: true, used_tool: usedTool, result: summarizeMcpResult(result, 4000) };
}

export async function browserMcpFillForm(opts: { fields?: unknown }): Promise<{ ok: boolean; used_tool: string; filled: number; results: unknown[] }> {
  const fields = requireArray(opts.fields, 'fields', 20);
  const { usedTool, tool } = await resolveBrowserToolInfo(['browser_fill', 'fill', 'browser_type', 'type']);
  const results: unknown[] = [];
  for (const [i, field] of fields.entries()) {
    if (!field || typeof field !== 'object') throw new Error(`fields[${i}] 必须是对象.`);
    const item = field as Record<string, unknown>;
    const ref = optionalString(item.ref, `fields[${i}].ref`, 200);
    const element = optionalString(item.element, `fields[${i}].element`, 300) || ref;
    if (!ref && !element) throw new Error(`fields[${i}] 需要 ref 或 element.`);
    const text = requireStringAllowEmpty(item.text, `fields[${i}].text`, 4000);
    const args = filterArgsByInputSchema(tool, { element, ref, text, value: text });
    results.push(summarizeMcpResult(await callBrowserMcpTool(usedTool, args), 2000));
  }
  return { ok: true, used_tool: usedTool, filled: fields.length, results };
}

export async function browserMcpSelectOption(opts: {
  ref?: unknown;
  element?: unknown;
  value?: unknown;
  label?: unknown;
  index?: unknown;
}): Promise<{ ok: boolean; used_tool: string; selected_by: string; result: unknown }> {
  const ref = optionalString(opts.ref, 'ref', 200);
  const element = optionalString(opts.element, 'element', 300) || ref;
  if (!ref && !element) throw new Error('browser_select_option 需要 ref 或 element.');
  const value = optionalString(opts.value, 'value', 500);
  const label = optionalString(opts.label, 'label', 500);
  const hasIndex = opts.index != null;
  const selectedCount = Number(!!value) + Number(!!label) + Number(hasIndex);
  if (selectedCount !== 1) throw new Error('value / label / index 必须且只能提供一个.');
  const index = hasIndex ? clampNumber(opts.index, 0, 0, 1000) : undefined;
  const selectedBy = value ? 'value' : label ? 'label' : 'index';
  const { usedTool, tool } = await resolveBrowserToolInfo(['browser_select_option', 'select_option', 'browser_select', 'select']);
  const args = filterArgsByInputSchema(tool, { element, ref, value, label, index, values: value ? [value] : undefined });
  const result = await callBrowserMcpTool(usedTool, args);
  return { ok: true, used_tool: usedTool, selected_by: selectedBy, result: summarizeMcpResult(result, 4000) };
}

export async function browserMcpSetChecked(opts: {
  ref?: unknown;
  element?: unknown;
  checked?: unknown;
}): Promise<{ ok: boolean; used_tool: string; checked: boolean; result: unknown }> {
  const ref = optionalString(opts.ref, 'ref', 200);
  const element = optionalString(opts.element, 'element', 300) || ref;
  if (!ref && !element) throw new Error('browser_set_checked 需要 ref 或 element.');
  const checked = optionalBoolean(opts.checked, true);
  const aliases = checked
    ? ['browser_check', 'check', 'browser_set_checked', 'set_checked']
    : ['browser_uncheck', 'uncheck', 'browser_set_checked', 'set_checked'];
  const { usedTool, tool } = await resolveBrowserToolInfo(aliases);
  const args = filterArgsByInputSchema(tool, { element, ref, checked });
  const result = await callBrowserMcpTool(usedTool, args);
  return { ok: true, used_tool: usedTool, checked, result: summarizeMcpResult(result, 4000) };
}

export async function browserMcpFileUpload(opts: {
  ref?: unknown;
  element?: unknown;
  paths?: unknown;
}): Promise<{ ok: boolean; used_tool: string; file_count: number; result: unknown }> {
  const paths = requireArray(opts.paths, 'paths', 5).map((value, i) => requireAbsolutePathString(value, `paths[${i}]`));
  const ref = optionalString(opts.ref, 'ref', 200);
  const element = optionalString(opts.element, 'element', 300) || ref;
  const { usedTool, tool } = await resolveBrowserToolInfo(['browser_file_upload', 'file_upload', 'browser_upload_file', 'upload_file']);
  const args = filterArgsByInputSchema(tool, { element, ref, paths, files: paths, path: paths[0] });
  const result = await callBrowserMcpTool(usedTool, args);
  return { ok: true, used_tool: usedTool, file_count: paths.length, result: summarizeMcpResult(result, 4000) };
}

export async function browserMcpSubmitForm(opts: {
  ref?: unknown;
  element?: unknown;
  text?: unknown;
  method?: unknown;
  confirmPhrase?: unknown;
}): Promise<{ ok: boolean; used_tool: string; method: string; result: unknown }> {
  const confirmPhrase = requireString(opts.confirmPhrase, 'confirmPhrase', 20);
  if (confirmPhrase !== 'SUBMIT') throw new Error("browser_submit_form 需要 confirmPhrase='SUBMIT'.");
  const method = optionalString(opts.method, 'method', 20) || 'click';
  if (!['click', 'enter'].includes(method)) throw new Error('method 只能是 click/enter.');
  const ref = optionalString(opts.ref, 'ref', 200);
  const text = optionalString(opts.text, 'text', 300);
  const element = optionalString(opts.element, 'element', 300) || ref;
  const native = await maybeResolveBrowserToolInfo(['browser_submit', 'submit', 'browser_submit_form', 'submit_form']);
  if (native) {
    const args = filterArgsByInputSchema(native.tool, { element: element || text, ref, text, method, confirmPhrase });
    const result = await callBrowserMcpTool(native.usedTool, args);
    return { ok: true, used_tool: native.usedTool, method, result: summarizeMcpResult(result, 4000) };
  }
  if (method === 'click') {
    if (!ref && !element && !text) throw new Error('method=click 需要 ref、element 或 text.');
    const r = await browserMcpClick({ ref, text: text || element });
    return { ok: true, used_tool: r.used_tool, method, result: r.result };
  }
  if (!ref && !element) throw new Error('method=enter 需要 ref 或 element.');
  const focus = await browserMcpClick({ ref, text: element });
  const pressed = await browserMcpPressKey({ key: 'Enter' });
  return { ok: true, used_tool: `${focus.used_tool}+${pressed.used_tool}`, method, result: { focus: focus.result, press: pressed.result } };
}

export async function browserMcpDownload(opts: {
  ref?: unknown;
  text?: unknown;
  timeout_ms?: unknown;
  save_as?: unknown;
}): Promise<{ ok: boolean; used_tool: string; timeout_ms: number; result: unknown }> {
  const ref = optionalString(opts.ref, 'ref', 200);
  const text = optionalString(opts.text, 'text', 300);
  const timeoutMs = clampNumber(opts.timeout_ms, 30000, 1000, 120000);
  const saveAs = opts.save_as == null ? undefined : requireAbsolutePathString(opts.save_as, 'save_as');
  const { usedTool, tool } = await resolveBrowserToolInfo([
    'browser_download',
    'download',
    'browser_wait_for_download',
    'wait_for_download',
    'browser_save_download',
    'save_download',
    'browser_expect_download',
    'expect_download'
  ]);
  const args = filterArgsByInputSchema(tool, { ref, element: text || ref, text, timeout: timeoutMs, timeout_ms: timeoutMs, saveAs, save_as: saveAs });
  const result = await callBrowserMcpTool(usedTool, args);
  return { ok: true, used_tool: usedTool, timeout_ms: timeoutMs, result: summarizeMcpResult(result, 4000) };
}

export async function browserMcpTabs(opts: {
  action?: unknown;
  index?: unknown;
  url?: unknown;
} = {}): Promise<{ ok: boolean; used_tool: string; action: string; result: unknown }> {
  const action = optionalString(opts.action, 'action', 20) || 'list';
  if (!['list', 'new', 'select', 'close'].includes(action)) throw new Error('action 只能是 list/new/select/close.');
  const index = ['select', 'close'].includes(action) ? clampNumber(opts.index, 0, 0, 1000) : undefined;
  if (['select', 'close'].includes(action) && opts.index == null) throw new Error(`${action} 需要 index.`);
  const url = opts.url == null ? undefined : validateHttpUrl(opts.url);
  const { usedTool, tool } = await resolveBrowserToolInfo(['browser_tabs', 'tabs', 'browser_tab', 'tab']);
  const args = filterArgsByInputSchema(tool, { action, index, url });
  const result = await callBrowserMcpTool(usedTool, args);
  return { ok: true, used_tool: usedTool, action, result: summarizeMcpResult(result, 4000) };
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

const ALLOWED_KEYS = new Set([
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Control+A',
  'Control+C',
  'Control+V',
  'Meta+A',
  'Meta+C',
  'Meta+V'
]);

async function callResolvedBrowserTool(names: string[], args: Record<string, unknown>): Promise<{ usedTool: string; result: unknown }> {
  const usedTool = await resolveBrowserTool(names);
  return { usedTool, result: await callBrowserMcpTool(usedTool, args) };
}

async function resolveBrowserTool(names: string[]): Promise<string> {
  return (await resolveBrowserToolInfo(names)).usedTool;
}

async function resolveBrowserToolInfo(names: string[]): Promise<{ usedTool: string; tool: any }> {
  const tools = await listBrowserMcpTools();
  const available = toolNames(tools);
  const usedTool = findToolName(available, names);
  if (!usedTool) throw missingToolError(names.join('/'), available);
  return { usedTool, tool: tools.find((tool) => String(tool.name) === usedTool) };
}

async function maybeResolveBrowserToolInfo(names: string[]): Promise<{ usedTool: string; tool: any } | undefined> {
  const tools = await listBrowserMcpTools();
  const available = toolNames(tools);
  const usedTool = findToolName(available, names);
  return usedTool ? { usedTool, tool: tools.find((tool) => String(tool.name) === usedTool) } : undefined;
}

function filterArgsByInputSchema(tool: any, args: Record<string, unknown>): Record<string, unknown> {
  const properties = tool?.inputSchema?.properties;
  if (!properties || typeof properties !== 'object') return dropUndefined(args);
  const allowed = new Set(Object.keys(properties));
  return Object.fromEntries(Object.entries(args).filter(([key, value]) => allowed.has(key) && value !== undefined));
}

function dropUndefined(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
}

function toolNames(tools: any[]): string[] {
  return tools.map((tool) => String(tool.name)).filter(Boolean);
}

function findToolName(available: string[], aliases: string[]): string | undefined {
  return available.find((name) => aliases.includes(name));
}

function missingToolError(label: string, available: string[]): Error {
  return new Error(`Playwright MCP 未暴露${label}工具. 可用工具=${available.join(', ') || '(无)'}`);
}

function validateHttpUrl(value: unknown): string {
  const url = requireString(value, 'url', 4096);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`无效 URL: ${url}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`browser_goto 仅允许 http/https URL, 当前协议=${parsed.protocol}`);
  }
  return parsed.toString();
}

function requireString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${name} 必须是字符串.`);
  const text = value.trim();
  if (!text) throw new Error(`${name} 不能为空.`);
  if (text.length > maxLength) throw new Error(`${name} 过长, 最大 ${maxLength} 字符.`);
  return text;
}

function optionalString(value: unknown, name: string, maxLength: number): string | undefined {
  if (value == null) return undefined;
  return requireString(value, name, maxLength);
}

function requireStringAllowEmpty(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${name} 必须是字符串.`);
  if (value.length > maxLength) throw new Error(`${name} 过长, 最大 ${maxLength} 字符.`);
  return value;
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') throw new Error('布尔参数必须是 true/false.');
  return value;
}

function requireArray(value: unknown, name: string, maxItems: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} 必须是数组.`);
  if (!value.length) throw new Error(`${name} 不能为空.`);
  if (value.length > maxItems) throw new Error(`${name} 最多 ${maxItems} 项.`);
  return value;
}

function requireAbsolutePathString(value: unknown, name: string): string {
  const p = requireString(value, name, 4096);
  if (!path.isAbsolute(p)) throw new Error(`${name} 必须是绝对路径.`);
  return p;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function summarizeMcpResult(value: unknown, maxChars: number): unknown {
  if (!value) return value;
  if (typeof value === 'string') return summarizeText(value, maxChars);
  const content = (value as any).content;
  if (Array.isArray(content)) {
    return {
      ...(value as any),
      content: content.map((item) => {
        if (item?.type === 'image' || typeof item?.data === 'string') {
          return { type: item?.type ?? 'image', mimeType: item?.mimeType, dataLength: String(item.data ?? '').length };
        }
        if (typeof item?.text === 'string') return { ...item, text: summarizeText(item.text, maxChars) };
        return item;
      })
    };
  }
  return summarizeText(JSON.stringify(value), maxChars);
}

function summarizeText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…[truncated ${text.length - maxChars} chars]` : text;
}

function extractText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const content = (value as any).content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item?.text === 'string') return item.text;
        if (item?.type === 'image' || typeof item?.data === 'string') return `[${item?.type ?? 'binary'}:${String(item.data ?? '').length} chars]`;
        return JSON.stringify(item);
      })
      .join('\n');
  }
  return JSON.stringify(value);
}
