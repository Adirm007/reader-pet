import { CSSProperties } from 'react';

interface Props {
  onClick?: () => void;
}

/**
 * 像素小人占位:
 * 银发紫眸 + 白衬衫 + 黑白裙(简化版)
 * 后期由用户在设置中导入正式立绘替换
 */
export default function PetSprite({ onClick }: Props) {
  return (
    <div
      className="pet-sprite drag-handle"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      onClick={onClick}
    >
      <svg
        width="160"
        height="220"
        viewBox="0 0 32 44"
        shapeRendering="crispEdges"
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        {/* 头发外轮廓 银灰 */}
        <rect x="9" y="3" width="14" height="2" fill="#c9c9d4" />
        <rect x="7" y="5" width="18" height="2" fill="#c9c9d4" />
        <rect x="6" y="7" width="20" height="6" fill="#c9c9d4" />
        {/* 长发拖到肩膀 */}
        <rect x="5" y="13" width="3" height="10" fill="#bcbcc8" />
        <rect x="24" y="13" width="3" height="10" fill="#bcbcc8" />

        {/* 脸 */}
        <rect x="10" y="9" width="12" height="6" fill="#fbe6d4" />
        <rect x="10" y="13" width="12" height="2" fill="#fbe6d4" />
        {/* 眼睛 琉璃紫 */}
        <rect x="12" y="11" width="2" height="2" fill="#7b5fbf" />
        <rect x="18" y="11" width="2" height="2" fill="#7b5fbf" />
        {/* 嘴 */}
        <rect x="15" y="14" width="2" height="1" fill="#c97a8a" />

        {/* 衬衫 白色 */}
        <rect x="9" y="16" width="14" height="6" fill="#fafafa" />
        <rect x="8" y="17" width="1" height="4" fill="#fafafa" />
        <rect x="23" y="17" width="1" height="4" fill="#fafafa" />
        {/* 衬衫荷叶边阴影 */}
        <rect x="9" y="22" width="14" height="1" fill="#dedede" />

        {/* 裙子 黑白交叠 */}
        <rect x="8" y="23" width="7" height="9" fill="#1a1a1a" />
        <rect x="15" y="23" width="9" height="9" fill="#f0f0f0" />
        <rect x="8" y="32" width="9" height="3" fill="#f0f0f0" />
        <rect x="17" y="32" width="7" height="3" fill="#1a1a1a" />

        {/* 裤袜 黑 */}
        <rect x="11" y="35" width="3" height="5" fill="#1a1a1a" />
        <rect x="18" y="35" width="3" height="5" fill="#1a1a1a" />
        {/* 小皮靴 */}
        <rect x="10" y="40" width="5" height="3" fill="#0d0d0d" />
        <rect x="17" y="40" width="5" height="3" fill="#0d0d0d" />

        {/* 手套 黑 (袖口) */}
        <rect x="7" y="21" width="2" height="2" fill="#0d0d0d" />
        <rect x="23" y="21" width="2" height="2" fill="#0d0d0d" />
      </svg>
    </div>
  );
}
