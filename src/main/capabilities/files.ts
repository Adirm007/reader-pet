// 文件能力 — 全部经过 permissions gate
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { checkFileRead, checkFileWrite } from '../permissions';

export async function fileRead(path: string): Promise<string> {
  const decision = checkFileRead(path);
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  return fs.readFile(resolve(path), 'utf-8');
}

export async function fileWrite(path: string, content: string): Promise<void> {
  const decision = checkFileWrite(path);
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  await fs.writeFile(resolve(path), content, 'utf-8');
}

export async function fileList(dir: string): Promise<string[]> {
  const decision = checkFileRead(dir);
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  return fs.readdir(resolve(dir));
}

export async function fileStat(path: string): Promise<{ size: number; isDir: boolean; mtime: number }> {
  const decision = checkFileRead(path);
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  const s = await fs.stat(resolve(path));
  return { size: s.size, isDir: s.isDirectory(), mtime: s.mtimeMs };
}
