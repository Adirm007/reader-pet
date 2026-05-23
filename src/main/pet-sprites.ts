// 桌宠精灵图包加载层
// 支持两个根:
//   1. resources/pet-sprites/                (随安装包发布, 开发时是仓库根目录)
//   2. <userData>/pet-sprites/               (用户自己丢的, 不需要重打包)
//
// 每个子目录是一个独立的"精灵图包":
//   pet-sprites/<id>/pet.json
//   pet-sprites/<id>/spritesheet.webp   (或 png/gif)
//
// pet.json 兼容 hatch-pet 的最小字段 (id/displayName/description/spritesheetPath),
// 并扩展 cellWidth/cellHeight/cols/rows/clips. 缺字段时用 hatch-pet 默认值补齐.
import { app } from 'electron';
import { promises as fs, existsSync } from 'fs';
import { join, extname, resolve } from 'path';
import type { PetSpritePackage, PetState, PetStateClip } from '../shared/types';

const MIME_MAP: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif'
};

// hatch-pet 默认行映射 → 我们的语义 state
const DEFAULT_CLIPS: Record<PetState, PetStateClip> = {
  idle: { row: 0, frames: 6, fps: 6, loop: true },
  talk: { row: 3, frames: 6, fps: 8, loop: true },  // waving
  think: { row: 7, frames: 6, fps: 6, loop: true }, // running (非定向工作)
  happy: { row: 4, frames: 6, fps: 10, loop: true },// jumping
  sleep: { row: 6, frames: 4, fps: 4, loop: true }, // waiting
  failed: { row: 5, frames: 4, fps: 6, loop: false }
};

function rootsToScan(): string[] {
  const roots: string[] = [];
  // 1) 打包后的 resources/pet-sprites
  try {
    const r1 = join(process.resourcesPath ?? '', 'pet-sprites');
    if (existsSync(r1)) roots.push(r1);
  } catch {
    /* ignore */
  }
  // 2) 开发模式: 仓库根的 resources/pet-sprites
  try {
    const r2 = resolve(process.cwd(), 'resources', 'pet-sprites');
    if (existsSync(r2) && !roots.includes(r2)) roots.push(r2);
  } catch {
    /* ignore */
  }
  // 3) 用户自定义 (<userData>/pet-sprites)
  try {
    const r3 = join(app.getPath('userData'), 'pet-sprites');
    if (existsSync(r3)) roots.push(r3);
  } catch {
    /* ignore */
  }
  return roots;
}

async function readManifest(dir: string, id: string): Promise<PetSpritePackage | null> {
  const manifestPath = join(dir, 'pet.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PetSpritePackage>;
    const sheetRel = parsed.spritesheetPath || 'spritesheet.webp';
    const sheetAbs = join(dir, sheetRel);
    if (!existsSync(sheetAbs)) return null;

    const ext = extname(sheetAbs).toLowerCase();
    const mime = MIME_MAP[ext];
    if (!mime) return null;

    const bytes = await fs.readFile(sheetAbs);
    const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;

    // clips 合并: 缺什么补什么
    const inClips = (parsed.clips || {}) as Partial<Record<PetState, PetStateClip>>;
    const clips = {} as Record<PetState, PetStateClip>;
    (Object.keys(DEFAULT_CLIPS) as PetState[]).forEach((k) => {
      clips[k] = { ...DEFAULT_CLIPS[k], ...(inClips[k] ?? {}) };
    });

    return {
      id: parsed.id || id,
      displayName: parsed.displayName || id,
      description: parsed.description,
      spritesheetPath: sheetRel,
      spritesheetDataUrl: dataUrl,
      cellWidth: parsed.cellWidth ?? 192,
      cellHeight: parsed.cellHeight ?? 208,
      cols: parsed.cols ?? 8,
      rows: parsed.rows ?? 9,
      clips
    };
  } catch {
    return null;
  }
}

export async function listSpritePackages(): Promise<Array<{ id: string; displayName: string; description?: string }>> {
  const out: Array<{ id: string; displayName: string; description?: string }> = [];
  const seen = new Set<string>();
  for (const root of rootsToScan()) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (seen.has(e.name)) continue;
        const pkg = await readManifest(join(root, e.name), e.name);
        if (pkg) {
          seen.add(e.name);
          out.push({ id: pkg.id, displayName: pkg.displayName, description: pkg.description });
        }
      }
    } catch {
      /* 单个根读失败不影响其它 */
    }
  }
  return out;
}

export async function loadSpritePackage(id: string): Promise<PetSpritePackage | null> {
  if (!id) return null;
  for (const root of rootsToScan()) {
    const dir = join(root, id);
    if (!existsSync(dir)) continue;
    const pkg = await readManifest(dir, id);
    if (pkg) return pkg;
  }
  return null;
}

export function getUserSpriteDir(): string {
  return join(app.getPath('userData'), 'pet-sprites');
}
