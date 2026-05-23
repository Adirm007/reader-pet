import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { PetSpritePackage, PetState } from '../../../shared/types';

interface Props {
  onClick?: () => void;
  pkg: PetSpritePackage | null;     // 为 null → 渲染 SVG 占位
  state: PetState;
  displayWidth: number;             // 屏幕上要画多大 (px)
}

/**
 * 桌宠精灵图渲染器
 *
 * - 没装 pkg 时, 渲染原来的 SVG (银发紫眸 Q 版小人), 兼容旧行为
 * - 装了 pkg 时, 用一张精灵图 + background-position 切帧
 *   按 clip.fps 切列 (col), 按 state 切行 (row)
 *
 * 关键: 用 background-image 而不是 <img/canvas>, 因为
 *   1. transparent webp 直接走浏览器原生解码, 没额外消耗
 *   2. backgroundSize 可以精确放缩到我们想要的展示尺寸
 *   3. 切帧只改 backgroundPosition, 无 React 重渲染
 */
export default function PetSprite({ onClick, pkg, state, displayWidth }: Props) {
  const containerStyle: CSSProperties = {
    WebkitAppRegion: 'drag'
  } as CSSProperties;

  if (!pkg) {
    return (
      <div className="pet-sprite drag-handle" style={containerStyle} onClick={onClick}>
        <FallbackSvg displayWidth={displayWidth} />
      </div>
    );
  }

  return (
    <div className="pet-sprite drag-handle" style={containerStyle} onClick={onClick}>
      <SpriteAtlasView pkg={pkg} state={state} displayWidth={displayWidth} />
    </div>
  );
}

function SpriteAtlasView({
  pkg,
  state,
  displayWidth
}: {
  pkg: PetSpritePackage;
  state: PetState;
  displayWidth: number;
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
    const interval = Math.max(40, Math.floor(1000 / Math.max(1, clip.fps)));
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
  }, [clip.frames, clip.fps, clip.loop, pkg.id, state]);

  const style = useMemo<CSSProperties>(() => {
    return {
      width: w,
      height: h,
      backgroundImage: pkg.spritesheetDataUrl ? `url(${pkg.spritesheetDataUrl})` : undefined,
      backgroundRepeat: 'no-repeat',
      backgroundSize: `${sheetW}px ${sheetH}px`,
      backgroundPosition: `-${frame * w}px -${clip.row * h}px`,
      imageRendering: 'auto',
      WebkitAppRegion: 'no-drag'
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
