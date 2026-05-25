import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { PetSpritePackage, PetState } from '../../../shared/types';

interface Props {
  onClick?: () => void;
  onDoubleClick?: () => void;
  pkg: PetSpritePackage | null;     // 为 null → 渲染 SVG 占位
  state: PetState;
  displayWidth: number;             // 屏幕上要画多大 (px)
  fpsMultiplier?: number;           // 全局速度倍率 (默认 1.0)
  draggable?: boolean;              // true: 走主进程手动拖动 (桌宠用); false: 纯点击 (设置面板预览用)
}

/**
 * 桌宠精灵图渲染器
 *
 * 拖动: 不用 -webkit-app-region (它会吞掉所有鼠标事件, 导致 onClick 失效).
 * 改成 mousedown→main:pet:startDrag, mouseup→main:pet:endDrag,
 * 同时算位移; 位移 <5px 视为点击.
 *
 * 双击: mouseup 时小位移就延迟 280ms 触发 onClick; 280ms 内再来一次就当 onDoubleClick.
 * 这样开输入框 (单击) 和开面板 (双击) 不会互相打架.
 */
export default function PetSprite({
  onClick,
  onDoubleClick,
  pkg,
  state,
  displayWidth,
  fpsMultiplier,
  draggable
}: Props) {
  const downPosRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastClickTsRef = useRef(0);
  const pendingClickRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    downPosRef.current = { x: e.screenX, y: e.screenY, t: Date.now() };
    if (draggable) void (window as any).api?.petStartDrag?.();
  };
  const handleMouseUp = (e: React.MouseEvent) => {
    const start = downPosRef.current;
    downPosRef.current = null;
    if (draggable) void (window as any).api?.petEndDrag?.();
    if (!start) return;
    const dist = Math.abs(e.screenX - start.x) + Math.abs(e.screenY - start.y);
    if (dist >= 5) return; // 算拖动, 不触发点击

    const now = Date.now();
    if (now - lastClickTsRef.current < 350 && onDoubleClick) {
      // 双击 — 取消挂起的单击, 触发双击
      if (pendingClickRef.current) {
        clearTimeout(pendingClickRef.current);
        pendingClickRef.current = null;
      }
      lastClickTsRef.current = 0;
      onDoubleClick();
      return;
    }
    lastClickTsRef.current = now;
    if (onClick) {
      if (onDoubleClick) {
        // 有双击监听 — 延迟 280ms 触发单击, 给双击留检测窗口
        pendingClickRef.current = setTimeout(() => {
          pendingClickRef.current = null;
          onClick();
        }, 280);
      } else {
        onClick();
      }
    }
  };

  if (!pkg) {
    return (
      <div
        className="pet-sprite drag-handle"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        <FallbackSvg displayWidth={displayWidth} />
      </div>
    );
  }

  return (
    <div
      className="pet-sprite drag-handle"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <SpriteAtlasView pkg={pkg} state={state} displayWidth={displayWidth} fpsMultiplier={fpsMultiplier ?? 1} />
    </div>
  );
}

function SpriteAtlasView({
  pkg,
  state,
  displayWidth,
  fpsMultiplier
}: {
  pkg: PetSpritePackage;
  state: PetState;
  displayWidth: number;
  fpsMultiplier: number;
}) {
  const clip = pkg.clips[state] ?? pkg.clips.idle;
  const aspect = pkg.cellHeight / pkg.cellWidth;
  const w = displayWidth;
  const h = Math.round(displayWidth * aspect);

  // 整张图的展示尺寸 (按 cell 等比缩放)
  const sheetW = pkg.cols * w;
  const sheetH = pkg.rows * h;

  const frameRef = useRef(0);
  const [frame, setFrame] = useState(0);

  // 切换 state 时归零, 重新跑
  useEffect(() => {
    frameRef.current = 0;
    setFrame(0);
  }, [state, pkg.id]);

  // 按 fps 推进帧
  useEffect(() => {
    if (clip.frames <= 1) return;
    const effectiveFps = Math.max(0.5, clip.fps * Math.max(0.2, fpsMultiplier));
    const interval = Math.max(40, Math.floor(1000 / effectiveFps));
    const loop = clip.loop !== false;
    const id = setInterval(() => {
      frameRef.current = frameRef.current + 1;
      if (frameRef.current >= clip.frames) {
        if (loop) frameRef.current = 0;
        else {
          frameRef.current = clip.frames - 1;
          clearInterval(id);
        }
      }
      setFrame(frameRef.current);
    }, interval);
    return () => clearInterval(id);
  }, [clip.frames, clip.fps, clip.loop, pkg.id, state, fpsMultiplier]);

  const style = useMemo<CSSProperties>(() => {
    return {
      width: w,
      height: h,
      backgroundImage: pkg.spritesheetDataUrl ? `url(${pkg.spritesheetDataUrl})` : undefined,
      backgroundRepeat: 'no-repeat',
      backgroundSize: `${sheetW}px ${sheetH}px`,
      backgroundPosition: `-${frame * w}px -${clip.row * h}px`,
      imageRendering: 'auto'
    } as CSSProperties;
  }, [w, h, sheetW, sheetH, frame, clip.row, pkg.spritesheetDataUrl]);

  return <div style={style} />;
}

/**
 * Fallback 占位 — 原来的银发紫眸 Q 版 SVG, 没有动画
 * (留作没安装精灵图包时, 让桌宠也能跑通)
 */
function FallbackSvg({ displayWidth }: { displayWidth: number }) {
  const h = Math.round((displayWidth * 220) / 160);
  return (
    <svg
      width={displayWidth}
      height={h}
      viewBox="0 0 32 44"
      shapeRendering="crispEdges"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      <rect x="9" y="3" width="14" height="2" fill="#c9c9d4" />
      <rect x="7" y="5" width="18" height="2" fill="#c9c9d4" />
      <rect x="6" y="7" width="20" height="6" fill="#c9c9d4" />
      <rect x="5" y="13" width="3" height="10" fill="#bcbcc8" />
      <rect x="24" y="13" width="3" height="10" fill="#bcbcc8" />
      <rect x="10" y="9" width="12" height="6" fill="#fbe6d4" />
      <rect x="10" y="13" width="12" height="2" fill="#fbe6d4" />
      <rect x="12" y="11" width="2" height="2" fill="#7b5fbf" />
      <rect x="18" y="11" width="2" height="2" fill="#7b5fbf" />
      <rect x="15" y="14" width="2" height="1" fill="#c97a8a" />
      <rect x="9" y="16" width="14" height="6" fill="#fafafa" />
      <rect x="8" y="17" width="1" height="4" fill="#fafafa" />
      <rect x="23" y="17" width="1" height="4" fill="#fafafa" />
      <rect x="9" y="22" width="14" height="1" fill="#dedede" />
      <rect x="8" y="23" width="7" height="9" fill="#1a1a1a" />
      <rect x="15" y="23" width="9" height="9" fill="#f0f0f0" />
      <rect x="8" y="32" width="9" height="3" fill="#f0f0f0" />
      <rect x="17" y="32" width="7" height="3" fill="#1a1a1a" />
      <rect x="11" y="35" width="3" height="5" fill="#1a1a1a" />
      <rect x="18" y="35" width="3" height="5" fill="#1a1a1a" />
      <rect x="10" y="40" width="5" height="3" fill="#0d0d0d" />
      <rect x="17" y="40" width="5" height="3" fill="#0d0d0d" />
      <rect x="7" y="21" width="2" height="2" fill="#0d0d0d" />
      <rect x="23" y="21" width="2" height="2" fill="#0d0d0d" />
    </svg>
  );
}
