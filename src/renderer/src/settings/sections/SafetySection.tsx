import { useEffect, useRef, useState } from 'react';
import type { AppConfig, CapabilityDescriptor } from '../../../../shared/types';

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
  const [pwInstalled, setPwInstalled] = useState(false);
  const [memInstalled, setMemInstalled] = useState(false);
  const timerRef = useRef<number | null>(null);

  const refreshExtras = async () => {
    const [c, pw, mem] = await Promise.all([
      window.api.listCapabilities(),
      window.api.isPlaywrightInstalled(),
      window.api.isMemoryRWInstalled()
    ]);
    setCaps(c);
    setPwInstalled(pw);
    setMemInstalled(mem);
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
              <td>{availLabel(c, cfg)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>危险模式专属开关</h3>
      <div className="muted" style={{ marginBottom: 8 }}>
        必须先切到危险模式; 这两项还需要原生模块, 没装时只能开关关掉再装.
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          disabled={!isDanger}
          checked={cfg.capabilities.playwrightEnabled}
          onChange={(e) => toggleCap('playwrightEnabled', e.target.checked)}
        />
        启用浏览器自动化 (Playwright){' '}
        <span className="muted" style={{ fontSize: 12 }}>
          {pwInstalled ? '· 已安装' : '· 未安装 (运行时调用会报错)'}
        </span>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          disabled={!isDanger}
          checked={cfg.capabilities.memoryRWEnabled}
          onChange={(e) => toggleCap('memoryRWEnabled', e.target.checked)}
        />
        启用游戏内存读写 (memoryjs · 仅 Windows){' '}
        <span className="muted" style={{ fontSize: 12 }}>
          {memInstalled ? '· 已安装' : '· 未安装'}
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

function availLabel(c: CapabilityDescriptor, cfg: AppConfig): string {
  const isDanger = cfg.safetyMode === 'danger';
  if (c.id === 'browser') {
    if (!isDanger) return '禁用';
    return cfg.capabilities.playwrightEnabled ? '已启用' : '可用但未勾选';
  }
  if (c.id === 'memory_rw') {
    if (!isDanger) return '禁用';
    return cfg.capabilities.memoryRWEnabled ? '已启用' : '可用但未勾选';
  }
  if (isDanger || c.available_in_safe) return '可用';
  return '禁用';
}
