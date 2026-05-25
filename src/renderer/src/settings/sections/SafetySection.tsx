import { useEffect, useRef, useState } from 'react';
import type { AppConfig, CapabilityDescriptor, CapabilityStatus } from '../../../../shared/types';

const COUNTDOWN_SECONDS = 10;

export default function SafetySection({
  cfg,
  onChange
}: {
  cfg: AppConfig;
  onChange: () => void;
}) {
  const [showDangerDialog, setShowDangerDialog] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [phase, setPhase] = useState<'reading' | 'first-confirm' | 'second-confirm'>('reading');
  const [caps, setCaps] = useState<CapabilityDescriptor[]>([]);
  const [statuses, setStatuses] = useState<Record<string, CapabilityStatus>>({});
  const [stopResult, setStopResult] = useState<string>('');
  const timerRef = useRef<number | null>(null);

  const refreshExtras = async () => {
    const [c, s] = await Promise.all([
      window.api.listCapabilities(),
      window.api.listCapabilityStatuses()
    ]);
    setCaps(c);
    setStatuses(Object.fromEntries(s.map((item) => [item.id, item])));
  };

  useEffect(() => {
    refreshExtras();
  }, []);

  useEffect(() => {
    if (showDangerDialog && phase === 'reading') {
      setCountdown(COUNTDOWN_SECONDS);
      timerRef.current = window.setInterval(() => {
        setCountdown((s) => {
          if (s <= 1) {
            if (timerRef.current) window.clearInterval(timerRef.current);
            setPhase('first-confirm');
            return 0;
          }
          return s - 1;
        });
      }, 1000);
      return () => {
        if (timerRef.current) window.clearInterval(timerRef.current);
      };
    }
    return;
  }, [showDangerDialog, phase]);

  const switchToSafe = async () => {
    await window.api.setSafetyMode('safe');
    onChange();
  };

  const startSwitchToDanger = () => {
    setShowDangerDialog(true);
    setPhase('reading');
    setCountdown(COUNTDOWN_SECONDS);
  };

  const cancelSwitch = () => {
    setShowDangerDialog(false);
    setPhase('reading');
    if (timerRef.current) window.clearInterval(timerRef.current);
  };

  const finalConfirm = async () => {
    await window.api.setSafetyMode('danger');
    setShowDangerDialog(false);
    setPhase('reading');
    onChange();
  };

  const toggleCap = async (key: keyof AppConfig['capabilities'], val: boolean) => {
    await window.api.setConfig({
      capabilities: { ...cfg.capabilities, [key]: val }
    });
    onChange();
    refreshExtras();
  };

  const emergencyStop = async () => {
    const r = await window.api.emergencyStop();
    setStopResult(
      r.ok
        ? `已停止: ${r.stopped.length ? r.stopped.join(', ') : '无运行中能力'}`
        : `部分失败: ${r.errors.map((e) => `${e.id}: ${e.error}`).join(' | ')}`
    );
    refreshExtras();
  };

  const dangerToggle = (key: keyof AppConfig['capabilities'], label: string, status?: CapabilityStatus) => (
    <label className="checkbox-row">
      <input
        type="checkbox"
        disabled={!isDanger}
        checked={Boolean(cfg.capabilities[key])}
        onChange={(e) => toggleCap(key, e.target.checked)}
      />
      {label}{' '}
      <span className="muted" style={{ fontSize: 12 }}>
        · {status?.message ?? '状态未知'}
      </span>
    </label>
  );

  const isDanger = cfg.safetyMode === 'danger';

  return (
    <div className="section">
      <h2>安全模式</h2>
      <p className="muted">默认安全, 切到危险模式需要 10 秒阅读 + 二次确认.</p>

      <div className="mode-row">
        <div>
          <div className="mode-label">当前: {isDanger ? '⚠ 危险模式' : '✔ 安全模式'}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {isDanger
              ? '夜梦可读写任意路径、跑任意 shell 命令; 浏览器/内存读写需在下方单独勾选启用.'
              : '只读写白名单目录, shell 限制白名单首词, 不可启用浏览器自动化或游戏内存读写.'}
          </div>
        </div>
        <div>
          {isDanger ? (
            <button className="primary" onClick={switchToSafe}>切回安全</button>
          ) : (
            <button className="danger" onClick={startSwitchToDanger}>切到危险模式…</button>
          )}
        </div>
      </div>

      <div className="mode-row" style={{ marginTop: 16 }}>
        <div>
          <div className="mode-label">紧急停止</div>
          <div className="muted" style={{ fontSize: 12 }}>
            中断 MCP、屏幕观察、内存扫描、MAA、CLI-Anything、桌面自动化等实现了 stop hook 的能力.
          </div>
          {stopResult && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{stopResult}</div>}
        </div>
        <button className="danger" onClick={emergencyStop}>紧急停止所有能力</button>
      </div>

      <h3 style={{ marginTop: 24 }}>能力清单</h3>
      <table className="cap-table">
        <thead>
          <tr>
            <th>能力</th>
            <th>风险</th>
            <th>安全模式</th>
            <th>危险模式</th>
            <th>当前</th>
          </tr>
        </thead>
        <tbody>
          {caps.map((c) => (
            <tr key={c.id}>
              <td>
                <strong>{c.display_name}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{c.description}</div>
              </td>
              <td><span className={`risk risk-${c.risk_level}`}>{c.risk_level}</span></td>
              <td>{c.available_in_safe ? '✔' : '—'}</td>
              <td>{c.available_in_danger ? (c.requires_extra_enable ? '需勾选' : '✔') : '—'}</td>
              <td>{availLabel(c, cfg, statuses[c.id])}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>危险模式专属开关</h3>
      <div className="muted" style={{ marginBottom: 8 }}>
        必须先切到危险模式; 这些能力即使在危险模式下也要单独勾选.
      </div>
      {dangerToggle('playwrightEnabled', '启用浏览器自动化 (Playwright MCP)', statuses.browser)}
      {dangerToggle('memoryRWEnabled', '启用游戏内存读写 (memoryjs · 仅 Windows)', statuses.memory_rw)}
      {dangerToggle('mcpEnabled', '启用 MCP 插件', statuses.mcp)}
      {dangerToggle('maaEnabled', '启用 MAA / MaaFramework', statuses.maa)}
      {dangerToggle('cliAnythingEnabled', '启用 CLI-Anything', statuses.cli_anything)}
      {dangerToggle('desktopAutomationEnabled', '启用桌面自动化', statuses.desktop_automation)}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={cfg.capabilities.screenObservationEnabled}
          onChange={(e) => toggleCap('screenObservationEnabled', e.target.checked)}
        />
        启用连续屏幕观察 (安全模式仍会弹窗确认){' '}
        <span className="muted" style={{ fontSize: 12 }}>
          · {statuses.screen_capture?.message ?? '状态未知'}
        </span>
      </label>

      <h3 style={{ marginTop: 24 }}>截屏</h3>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={cfg.capabilities.screenCaptureRequireConfirm}
          onChange={(e) =>
            toggleCap('screenCaptureRequireConfirm' as any, e.target.checked)
          }
        />
        安全模式下截屏前弹窗确认
      </label>

      {showDangerDialog && (
        <div className="modal-mask" onClick={(e) => e.stopPropagation()}>
          <div className="modal danger-modal">
            <h3>⚠ 切换到危险模式</h3>
            <div className="danger-warning">
              <p><strong>这意味着夜梦将获得以下放权:</strong></p>
              <ul>
                <li>读写任意可访问的本地文件 (含系统盘配置文件、私钥、邮件草稿等)</li>
                <li>执行任意 shell / PowerShell 命令 (含 删除 / 安装 / 联网下载等)</li>
                <li>启动浏览器自动化, 进入登录态站点 (在勾选启用时)</li>
                <li>读写其他进程的内存 (在勾选启用时, 触发杀软警报)</li>
              </ul>
              <p>
                <strong>误操作可能导致:</strong>{' '}
                工作丢失、配置被覆盖、密码外泄、被杀软隔离, 后果不可逆.
              </p>
              <p>
                <strong>请仅在你完全清楚自己在做什么时启用</strong>,
                并优先在白名单目录内验证.
              </p>
            </div>

            {phase === 'reading' && (
              <div className="countdown">
                请认真阅读 · 还需 <strong>{countdown}</strong> 秒
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  此倒计时是为了避免你在不经意间一键放权.
                </div>
              </div>
            )}

            <div className="form-actions" style={{ marginTop: 16 }}>
              <button onClick={cancelSwitch}>取消</button>
              {phase === 'first-confirm' && (
                <button className="danger" onClick={() => setPhase('second-confirm')}>
                  我已阅读并理解 · 第一次确认
                </button>
              )}
              {phase === 'second-confirm' && (
                <button className="danger" onClick={finalConfirm}>
                  最终确认 · 切到危险模式
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function availLabel(c: CapabilityDescriptor, cfg: AppConfig, status?: CapabilityStatus): string {
  const isDanger = cfg.safetyMode === 'danger';
  if (c.enable_flag) {
    if (!isDanger) return '禁用';
    return cfg.capabilities[c.enable_flag] ? statusLabel(status) : '可用但未勾选';
  }
  if (isDanger || c.available_in_safe) return statusLabel(status);
  return '禁用';
}

function statusLabel(status?: CapabilityStatus): string {
  if (!status) return '可用';
  if (status.status === 'available') return status.message ? `可用 · ${status.message}` : '可用';
  if (status.status === 'not_installed') return status.message ?? '未安装';
  if (status.status === 'disabled') return status.message ?? '禁用';
  if (status.status === 'blocked') return status.message ?? '阻止';
  return status.message ?? '不可用';
}
