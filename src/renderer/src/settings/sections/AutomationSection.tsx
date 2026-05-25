import { useEffect, useMemo, useState } from 'react';
import type { AppConfig, CapabilityRuntimeStatus, CapabilityStatus, McpServerConfig } from '../../../../shared/types';

type ToolMap = Record<string, string[]>;
type McpDiscoveryMap = Record<string, { resources?: string[]; prompts?: string[] }>;

function linesToArgs(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function argsToLines(value?: string[]): string {
  return (value ?? []).join('\n');
}

function newServer(): McpServerConfig {
  const id = `mcp-${Date.now().toString(36)}`;
  return {
    id,
    displayName: '新 MCP Server',
    transport: 'stdio',
    command: '',
    args: [],
    cwd: '',
    url: '',
    headers: {},
    enabled: false,
    riskLevel: 'high',
    allowedTools: [],
    allowAllTools: false
  };
}

export default function AutomationSection({
  cfg,
  onChange
}: {
  cfg: AppConfig;
  onChange: () => void;
}) {
  const [automation, setAutomation] = useState(cfg.automation);
  const [servers, setServers] = useState<McpServerConfig[]>(cfg.mcp.servers ?? []);
  const [statuses, setStatuses] = useState<Record<string, CapabilityStatus>>({});
  const [runtime, setRuntime] = useState<Record<string, CapabilityRuntimeStatus>>({});
  const [browserTools, setBrowserTools] = useState<string[]>([]);
  const [mcpTools, setMcpTools] = useState<ToolMap>({});
  const [mcpDiscovery, setMcpDiscovery] = useState<McpDiscoveryMap>({});
  const [cliSample, setCliSample] = useState('{"ping":"pong"}');
  const [maaTask, setMaaTask] = useState(cfg.automation.maaDefaultTask ?? '');
  const [maaProfile, setMaaProfile] = useState('');
  const [desktopQueueJson, setDesktopQueueJson] = useState('[\n  { "type": "wait", "ms": 1000 }\n]');
  const [msg, setMsg] = useState('');

  const isDanger = cfg.safetyMode === 'danger';

  const runtimeText = (id: string) => {
    const r = runtime[id];
    if (!r) return '运行态未知';
    if (!r.running) return r.lastError ? `空闲 · 上次错误: ${r.lastError}` : '空闲';
    return `运行中${r.detail ? ` · ${r.detail}` : ''}${r.pid ? ` · pid ${r.pid}` : ''}`;
  };

  const statusText = (id: string) => {
    const s = statuses[id];
    if (!s) return '状态未知';
    return s.message ? `${s.status} · ${s.message}` : s.status;
  };

  const refreshStatus = async () => {
    const [s, r] = await Promise.all([
      window.api.listCapabilityStatuses(),
      window.api.listCapabilityRuntimeStatuses()
    ]);
    setStatuses(Object.fromEntries(s.map((item) => [item.id, item])));
    setRuntime(Object.fromEntries(r.map((item) => [item.id, item])));
  };

  useEffect(() => {
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const saveAutomation = async () => {
    await window.api.setConfig({ automation });
    setMsg('本机能力命令配置已保存');
    await refreshStatus();
    onChange();
  };

  const saveServers = async (nextServers = servers) => {
    await window.api.setConfig({ mcp: { ...cfg.mcp, servers: nextServers } });
    setServers(nextServers);
    setMsg('MCP server 配置已保存');
    await refreshStatus();
    onChange();
  };

  const updateServer = (index: number, patch: Partial<McpServerConfig>) => {
    setServers((items) => items.map((server, i) => (i === index ? { ...server, ...patch } : server)));
  };

  const listBrowserTools = async () => {
    try {
      const tools = await window.api.listBrowserMcpTools();
      setBrowserTools(tools.map((tool: any) => String(tool.name ?? tool.id ?? JSON.stringify(tool))).filter(Boolean));
      setMsg('Playwright MCP tools 已刷新');
      await refreshStatus();
    } catch (e: any) {
      setMsg(`Playwright MCP 诊断失败: ${e?.message ?? String(e)}`);
    }
  };

  const listMcpTools = async (server: McpServerConfig) => {
    try {
      const tools = await window.api.listMcpTools(server.id);
      setMcpTools((current) => ({
        ...current,
        [server.id]: tools.map((tool: any) => String(tool.name ?? tool.id ?? JSON.stringify(tool))).filter(Boolean)
      }));
      setMsg(`MCP tools 已刷新: ${server.displayName || server.id}`);
      await refreshStatus();
    } catch (e: any) {
      setMsg(`MCP 诊断失败: ${e?.message ?? String(e)}`);
    }
  };

  const listMcpResourcesAndPrompts = async (server: McpServerConfig) => {
    try {
      const [resources, prompts] = await Promise.all([
        window.api.listMcpResources(server.id),
        window.api.listMcpPrompts(server.id)
      ]);
      setMcpDiscovery((current) => ({
        ...current,
        [server.id]: {
          resources: resources.map((item: any) => String(item.uri ?? item.name ?? JSON.stringify(item))).filter(Boolean),
          prompts: prompts.map((item: any) => String(item.name ?? item.id ?? JSON.stringify(item))).filter(Boolean)
        }
      }));
      setMsg(`MCP resources/prompts 已刷新: ${server.displayName || server.id}`);
      await refreshStatus();
    } catch (e: any) {
      setMsg(`MCP resources/prompts 诊断失败: ${e?.message ?? String(e)}`);
    }
  };

  const runMaaSample = async () => {
    try {
      const result = await window.api.maaRunTask({ task: maaTask.trim() || undefined, profile: maaProfile.trim() || undefined, timeoutMs: 120000 });
      setMsg(`MAA 试运行结果: ${JSON.stringify(result, null, 2)}`);
      await refreshStatus();
    } catch (e: any) {
      setMsg(`MAA 试运行失败: ${e?.message ?? String(e)}`);
    }
  };

  const stopAllCapabilities = async () => {
    const result = await window.api.emergencyStop();
    setMsg(`已请求停止: ${JSON.stringify(result, null, 2)}`);
    await refreshStatus();
  };

  const runDesktopQueue = async (dryRun: boolean) => {
    try {
      const actions = JSON.parse(desktopQueueJson);
      const result = await window.api.desktopRunQueue({ actions, dryRun, description: 'settings-test' });
      setMsg(`桌面自动化${dryRun ? ' dry-run' : ' run'} 结果: ${JSON.stringify(result, null, 2)}`);
      await refreshStatus();
    } catch (e: any) {
      setMsg(`桌面自动化执行失败: ${e?.message ?? String(e)}`);
    }
  };

  const runCliAnythingSample = async () => {
    try {
      const parsed = cliSample.trim() ? JSON.parse(cliSample) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('样例 input 必须是 JSON object');
      const result = await window.api.cliAnythingRun({ input: parsed as Record<string, unknown>, timeoutMs: 5000 });
      setMsg(`CLI-Anything 试运行结果: ${JSON.stringify(result, null, 2)}`);
      await refreshStatus();
    } catch (e: any) {
      setMsg(`CLI-Anything 试运行失败: ${e?.message ?? String(e)}`);
    }
  };

  const runningSummary = useMemo(() => {
    const running = Object.values(runtime).filter((item) => item.running);
    return running.length ? running.map((item) => `${item.id}${item.detail ? `(${item.detail})` : ''}`).join(', ') : '无运行中能力';
  }, [runtime]);

  return (
    <div className="section">
      <h2>本机能力 / 自动化</h2>
      <p className="muted">
        这里只保存你自己填写的本地命令和插件配置；高危能力仍需要危险模式 + 独立开关。
      </p>
      <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
        当前: {isDanger ? '危险模式' : '安全模式'} · 运行态: {runningSummary}
      </div>

      <CapabilityBlock title="Playwright MCP 浏览器" status={statusText('browser')} runtime={runtimeText('browser')} enabled={cfg.capabilities.playwrightEnabled} isDanger={isDanger}>
        <label>
          command
          <input
            value={automation.playwrightMcpCommand}
            onChange={(e) => setAutomation({ ...automation, playwrightMcpCommand: e.target.value })}
            placeholder="本地 Playwright MCP 命令路径"
          />
        </label>
        <label>
          args（每行一个参数）
          <textarea
            value={argsToLines(automation.playwrightMcpArgs)}
            onChange={(e) => setAutomation({ ...automation, playwrightMcpArgs: linesToArgs(e.target.value) })}
            rows={4}
          />
        </label>
        <label>
          cwd
          <input
            value={automation.playwrightMcpCwd ?? ''}
            onChange={(e) => setAutomation({ ...automation, playwrightMcpCwd: e.target.value })}
            placeholder="可选工作目录"
          />
        </label>
        <div className="form-actions">
          <button className="primary" onClick={saveAutomation}>保存命令配置</button>
          <button onClick={listBrowserTools}>列出 tools</button>
        </div>
        {browserTools.length > 0 && <ToolList tools={browserTools} />}
      </CapabilityBlock>

      <CapabilityBlock title="通用 MCP 插件" status={statusText('mcp')} runtime={runtimeText('mcp')} enabled={cfg.capabilities.mcpEnabled} isDanger={isDanger}>
        <p className="muted" style={{ fontSize: 12 }}>
          allowlist 只限制 tool 调用，不保证 server 启动本身无副作用；未知 server 不建议 allow all。
        </p>
        {servers.map((server, index) => (
          <div key={server.id} className="mode-row" style={{ display: 'block', marginTop: 12 }}>
            <label className="checkbox-row">
              <input checked={server.enabled} type="checkbox" onChange={(e) => updateServer(index, { enabled: e.target.checked })} />
              启用此 server
            </label>
            <label>
              id
              <input value={server.id} onChange={(e) => updateServer(index, { id: e.target.value.trim() })} />
            </label>
            <label>
              displayName
              <input value={server.displayName} onChange={(e) => updateServer(index, { displayName: e.target.value })} />
            </label>
            <label>
              transport
              <select value={server.transport ?? 'stdio'} onChange={(e) => updateServer(index, { transport: e.target.value as McpServerConfig['transport'] })}>
                <option value="stdio">stdio</option>
                <option value="http">http</option>
              </select>
            </label>
            <label>
              command
              <input value={server.command} onChange={(e) => updateServer(index, { command: e.target.value })} />
            </label>
            <label>
              args（每行一个参数）
              <textarea value={argsToLines(server.args)} rows={3} onChange={(e) => updateServer(index, { args: linesToArgs(e.target.value) })} />
            </label>
            <label>
              cwd
              <input value={server.cwd ?? ''} onChange={(e) => updateServer(index, { cwd: e.target.value })} />
            </label>
            <label>
              http url
              <input value={server.url ?? ''} onChange={(e) => updateServer(index, { url: e.target.value })} />
            </label>
            <label>
              http headers JSON
              <textarea
                value={JSON.stringify(server.headers ?? {}, null, 2)}
                rows={3}
                onChange={(e) => {
                  try {
                    const parsed = e.target.value.trim() ? JSON.parse(e.target.value) : {};
                    updateServer(index, { headers: parsed });
                  } catch {
                    setMsg('headers 必须是 JSON object');
                  }
                }}
              />
            </label>
            <label>
              riskLevel
              <select value={server.riskLevel} onChange={(e) => updateServer(index, { riskLevel: e.target.value as McpServerConfig['riskLevel'] })}>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input checked={Boolean(server.allowAllTools)} type="checkbox" onChange={(e) => updateServer(index, { allowAllTools: e.target.checked })} />
              允许调用全部 tools（高风险）
            </label>
            <label>
              allowedTools（每行一个）
              <textarea value={argsToLines(server.allowedTools)} rows={4} onChange={(e) => updateServer(index, { allowedTools: linesToArgs(e.target.value) })} />
            </label>
            <div className="form-actions">
              <button onClick={() => listMcpTools(server)}>列出 tools</button>
              <button onClick={() => listMcpResourcesAndPrompts(server)}>列 resources/prompts</button>
              <button onClick={() => setServers((items) => items.filter((_, i) => i !== index))}>删除</button>
            </div>
            {mcpTools[server.id]?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="muted" style={{ fontSize: 12 }}>发现 tools（点击加入 allowlist）</div>
                {mcpTools[server.id].map((tool) => (
                  <button
                    key={tool}
                    style={{ margin: '4px 6px 0 0' }}
                    onClick={() => updateServer(index, { allowedTools: Array.from(new Set([...(server.allowedTools ?? []), tool])) })}
                  >
                    {tool}
                  </button>
                ))}
              </div>
            )}
            {mcpDiscovery[server.id]?.resources?.length ? <ToolList tools={mcpDiscovery[server.id].resources ?? []} /> : null}
            {mcpDiscovery[server.id]?.prompts?.length ? <ToolList tools={mcpDiscovery[server.id].prompts ?? []} /> : null}
          </div>
        ))}
        <div className="form-actions">
          <button onClick={() => setServers([...servers, newServer()])}>新增 server</button>
          <button className="primary" onClick={() => saveServers()}>保存 MCP 配置</button>
        </div>
      </CapabilityBlock>

      <CapabilityBlock title="MAA / MaaFramework" status={statusText('maa')} runtime={runtimeText('maa')} enabled={cfg.capabilities.maaEnabled} isDanger={isDanger}>
        <label>
          command
          <input value={automation.maaCommand} onChange={(e) => setAutomation({ ...automation, maaCommand: e.target.value })} />
        </label>
        <label>
          working dir
          <input value={automation.maaWorkingDir} onChange={(e) => setAutomation({ ...automation, maaWorkingDir: e.target.value })} />
        </label>
        <label>
          assets dir
          <input value={automation.maaAssetsDir ?? ''} onChange={(e) => setAutomation({ ...automation, maaAssetsDir: e.target.value })} />
        </label>
        <label>
          task config path
          <input value={automation.maaTaskConfigPath ?? ''} onChange={(e) => setAutomation({ ...automation, maaTaskConfigPath: e.target.value })} />
        </label>
        <label>
          default task
          <input value={automation.maaDefaultTask ?? ''} onChange={(e) => {
            setAutomation({ ...automation, maaDefaultTask: e.target.value });
            setMaaTask(e.target.value);
          }} />
        </label>
        <label>
          extra args（每行一个参数）
          <textarea value={argsToLines(automation.maaExtraArgs)} rows={3} onChange={(e) => setAutomation({ ...automation, maaExtraArgs: linesToArgs(e.target.value) })} />
        </label>
        <label>
          试运行 task（留空使用 default task）
          <input value={maaTask} onChange={(e) => setMaaTask(e.target.value)} />
        </label>
        <label>
          试运行 profile（可选）
          <input value={maaProfile} onChange={(e) => setMaaProfile(e.target.value)} />
        </label>
        <div className="form-actions">
          <button className="primary" onClick={saveAutomation}>保存 MAA 配置</button>
          <button onClick={runMaaSample}>试运行</button>
          <button onClick={stopAllCapabilities}>停止运行中能力</button>
        </div>
      </CapabilityBlock>

      <CapabilityBlock title="CLI-Anything" status={statusText('cli_anything')} runtime={runtimeText('cli_anything')} enabled={cfg.capabilities.cliAnythingEnabled} isDanger={isDanger}>
        <p className="muted" style={{ fontSize: 12 }}>v1 协议：stdin 接收 {'{ version: 1, input, schema }'}，stdout 返回 JSON object；复杂长期插件优先用 MCP。</p>
        <label>
          command
          <input value={automation.cliAnythingCommand} onChange={(e) => setAutomation({ ...automation, cliAnythingCommand: e.target.value })} />
        </label>
        <label>
          args（每行一个参数）
          <textarea
            value={argsToLines(automation.cliAnythingArgs)}
            onChange={(e) => setAutomation({ ...automation, cliAnythingArgs: linesToArgs(e.target.value) })}
            rows={3}
          />
        </label>
        <label>
          working dir
          <input value={automation.cliAnythingWorkingDir} onChange={(e) => setAutomation({ ...automation, cliAnythingWorkingDir: e.target.value })} />
        </label>
        <label>
          试运行 input JSON
          <textarea value={cliSample} onChange={(e) => setCliSample(e.target.value)} rows={3} />
        </label>
        <div className="form-actions">
          <button className="primary" onClick={saveAutomation}>保存 CLI-Anything 配置</button>
          <button onClick={runCliAnythingSample}>试运行</button>
        </div>
      </CapabilityBlock>

      <CapabilityBlock title="桌面自动化" status={statusText('desktop_automation')} runtime={runtimeText('desktop_automation')} enabled={cfg.capabilities.desktopAutomationEnabled} isDanger={isDanger}>
        <p className="muted" style={{ fontSize: 12 }}>动作队列支持 click/typeText/hotkey/wait；真实 run 会操作当前桌面。</p>
        <label>
          provider
          <select
            value={automation.desktopAutomationProvider}
            onChange={(e) => setAutomation({ ...automation, desktopAutomationProvider: e.target.value as AppConfig['automation']['desktopAutomationProvider'] })}
          >
            <option value="none">none</option>
            <option value="powershell">powershell</option>
            <option value="nutjs">nutjs</option>
          </select>
        </label>
        <label>
          actions JSON
          <textarea value={desktopQueueJson} onChange={(e) => setDesktopQueueJson(e.target.value)} rows={7} />
        </label>
        <div className="form-actions">
          <button className="primary" onClick={saveAutomation}>保存桌面自动化配置</button>
          <button onClick={() => runDesktopQueue(true)}>dry-run</button>
          <button onClick={() => runDesktopQueue(false)}>run</button>
          <button onClick={stopAllCapabilities}>停止运行中能力</button>
        </div>
      </CapabilityBlock>

      {msg && <div className="test-msg">{msg}</div>}
    </div>
  );
}

function CapabilityBlock({
  title,
  status,
  runtime,
  enabled,
  isDanger,
  children
}: {
  title: string;
  status: string;
  runtime: string;
  enabled: boolean;
  isDanger: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mode-row" style={{ display: 'block', marginTop: 18 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        权限: {isDanger ? (enabled ? '危险模式 + 独立开关已启用' : '危险模式，但独立开关未启用') : '安全模式下不可用'} · 状态: {status} · 运行态: {runtime}
      </div>
      {children}
    </div>
  );
}

function ToolList({ tools }: { tools: string[] }) {
  return (
    <ul className="muted" style={{ fontSize: 12 }}>
      {tools.map((tool) => <li key={tool}>{tool}</li>)}
    </ul>
  );
}
