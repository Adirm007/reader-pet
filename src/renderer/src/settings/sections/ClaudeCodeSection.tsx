import { useEffect, useState } from 'react';
import type { AppConfig } from '../../../../shared/types';

export default function ClaudeCodeSection({
  cfg,
  onChange
}: {
  cfg: AppConfig;
  onChange: () => void;
}) {
  const [hookInstalled, setHookInstalled] = useState(false);
  const [bridgeRunning, setBridgeRunning] = useState(false);
  const [hint, setHint] = useState<string>('');

  const refresh = async () => {
    const [h, r] = await Promise.all([
      window.api.ccIsHookInstalled(),
      window.api.ccIsBridgeRunning()
    ]);
    setHookInstalled(h);
    setBridgeRunning(r);
  };

  useEffect(() => {
    refresh();
  }, [cfg.claudeCode.hookServerEnabled, cfg.claudeCode.hookServerPort]);

  const setEnabled = async (v: boolean) => {
    await window.api.setConfig({
      claudeCode: { ...cfg.claudeCode, hookServerEnabled: v }
    });
    onChange();
  };

  const setPort = async (p: number) => {
    await window.api.setConfig({
      claudeCode: { ...cfg.claudeCode, hookServerPort: p }
    });
    onChange();
  };

  const setCli = async (s: string) => {
    await window.api.setConfig({
      claudeCode: { ...cfg.claudeCode, cliPath: s }
    });
    onChange();
  };

  const setReportVoice = async (v: boolean) => {
    await window.api.setConfig({
      claudeCode: { ...cfg.claudeCode, reportInPersonaVoice: v }
    });
    onChange();
  };

  const startBridge = async () => {
    const r = await window.api.ccStartBridge();
    setHint(r.ok ? `已启动: 127.0.0.1:${r.port}` : `启动失败: ${r.reason}`);
    refresh();
  };

  const stopBridge = async () => {
    await window.api.ccStopBridge();
    setHint('已停止');
    refresh();
  };

  const installHook = async () => {
    const r = await window.api.ccInstallHook();
    setHint(r.message);
    refresh();
  };

  const uninstallHook = async () => {
    const r = await window.api.ccUninstallHook();
    setHint(r.message);
    refresh();
  };

  return (
    <div className="section">
      <h2>Claude Code 桥接</h2>
      <p className="muted">
        Claude Code 完成一项任务后, 通过 Stop hook 把结果推送到本地 HTTP 端口,
        夜梦会用当前人设语气向你复述.
      </p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={cfg.claudeCode.hookServerEnabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        启用 hook 接收服务 (127.0.0.1)
      </label>

      <label>
        端口:{' '}
        <input
          type="number"
          min={1024}
          max={65535}
          value={cfg.claudeCode.hookServerPort}
          onChange={(e) => setPort(Number(e.target.value))}
          style={{ width: 100 }}
        />
      </label>

      <label>
        Claude Code CLI 路径{' '}
        <span className="muted" style={{ fontSize: 12 }}>(留空走 PATH)</span>
        <input
          type="text"
          value={cfg.claudeCode.cliPath}
          onChange={(e) => setCli(e.target.value)}
          placeholder="claude"
        />
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={cfg.claudeCode.reportInPersonaVoice}
          onChange={(e) => setReportVoice(e.target.checked)}
        />
        汇报时使用当前人设语气 (会消耗一次小额 token)
      </label>

      <h3 style={{ marginTop: 24 }}>本地 hook 服务</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={startBridge} disabled={bridgeRunning}>
          启动
        </button>
        <button onClick={stopBridge} disabled={!bridgeRunning}>
          停止
        </button>
        <span className="muted">状态: {bridgeRunning ? '运行中' : '未运行'}</span>
      </div>

      <h3 style={{ marginTop: 24 }}>~/.claude/settings.json hook 注入</h3>
      <p className="muted" style={{ fontSize: 12 }}>
        会向 Stop hook 注册一条 PowerShell 命令, 把 Claude Code 的 stdin payload POST 到上面的端口.
        多次安装会自动去重 (按 marker 识别).
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={installHook}>{hookInstalled ? '重新安装' : '安装 hook'}</button>
        <button onClick={uninstallHook} disabled={!hookInstalled}>
          卸载 hook
        </button>
        <span className="muted">状态: {hookInstalled ? '已安装' : '未安装'}</span>
      </div>

      {hint && (
        <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
