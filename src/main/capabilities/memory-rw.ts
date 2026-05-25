// 游戏内存读写 (Cheat Engine 风格)
import { checkMemoryRW } from '../permissions';

export interface ProcessInfo {
  pid: number;
  name: string;
}

export type MemoryValueType = 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float' | 'double' | 'string' | 'bytes';

let _memoryjs: any = null;
let abortScan = false;

async function tryLoad() {
  if (_memoryjs) return _memoryjs;
  try {
    const mod = await import('memoryjs' as any);
    _memoryjs = mod.default ?? mod;
    return _memoryjs;
  } catch {
    return null;
  }
}

async function requireMemoryjs() {
  const decision = checkMemoryRW();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  const m = await tryLoad();
  if (!m) throw new Error('memoryjs 尚未安装. 请手动安装并确认 Windows/杀软允许加载原生模块.');
  return m;
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  const m = await requireMemoryjs();
  return new Promise((resolve, reject) => {
    m.getProcesses((err: any, processes: any[]) => {
      if (err) reject(err);
      else resolve(processes.map((p) => ({ pid: p.th32ProcessID, name: p.szExeFile })));
    });
  });
}

export async function readMemory(args: { pid: number; address: number | string; type: MemoryValueType; length?: number }) {
  const m = await requireMemoryjs();
  const proc = m.openProcess(Number(args.pid));
  const address = parseAddress(args.address);
  const type = mapType(m, args.type);
  const length = Math.max(1, Math.min(Number(args.length ?? 64), 4096));
  if (args.type === 'bytes') return { ok: true, value: m.readBuffer(proc.handle, address, length).toString('hex') };
  if (args.type === 'string') return { ok: true, value: m.readMemory(proc.handle, address, m.STRING, length) };
  return { ok: true, value: m.readMemory(proc.handle, address, type) };
}

export async function writeMemory(args: {
  pid: number;
  address: number | string;
  type: MemoryValueType;
  value: unknown;
  confirmPhrase?: string;
}) {
  if (args.confirmPhrase !== 'I_UNDERSTAND_MEMORY_WRITE_RISK') {
    throw new Error('内存写入需要 confirmPhrase=I_UNDERSTAND_MEMORY_WRITE_RISK');
  }
  const m = await requireMemoryjs();
  const proc = m.openProcess(Number(args.pid));
  const address = parseAddress(args.address);
  if (args.type === 'bytes') {
    const hex = String(args.value ?? '').replace(/\s+/g, '');
    if (!/^[0-9a-f]*$/i.test(hex) || hex.length > 8192 || hex.length % 2 !== 0) throw new Error('bytes 写入需要偶数长度十六进制字符串, 最多 4096 bytes');
    m.writeBuffer(proc.handle, address, Buffer.from(hex, 'hex'));
  } else {
    m.writeMemory(proc.handle, address, args.value, mapType(m, args.type));
  }
  return { ok: true };
}

export async function scanMemory(args: { pid: number; pattern: string; type?: MemoryValueType; maxResults?: number }) {
  const m = await requireMemoryjs();
  const proc = m.openProcess(Number(args.pid));
  const maxResults = Math.max(1, Math.min(Number(args.maxResults ?? 50), 100));
  abortScan = false;
  if (!m.findPattern) throw new Error('当前 memoryjs 版本未暴露 findPattern, 暂无法扫描');
  const hits: number[] = [];
  const regions = proc.modBaseAddr ? [{ base: proc.modBaseAddr, size: proc.modBaseSize ?? 0 }] : [];
  for (const region of regions) {
    if (abortScan) throw new Error('内存扫描已被紧急停止');
    const found = m.findPattern(proc.handle, region.base, region.size, String(args.pattern), m.NORMAL, 0);
    if (typeof found === 'number' && found > 0) hits.push(found);
    if (hits.length >= maxResults) break;
  }
  return { ok: true, hits: hits.slice(0, maxResults) };
}

export function stopMemoryScan(): void {
  abortScan = true;
}

export async function isMemoryRWInstalled(): Promise<boolean> {
  return (await tryLoad()) !== null;
}

function parseAddress(value: number | string): number {
  const n = typeof value === 'number' ? value : Number(String(value).trim().startsWith('0x') ? value : `0x${value}`);
  if (!Number.isFinite(n) || n < 0) throw new Error(`非法内存地址: ${value}`);
  return n;
}

function mapType(m: any, type: MemoryValueType): any {
  const table: Record<MemoryValueType, any> = {
    int8: m.INT8,
    uint8: m.UINT8,
    int16: m.INT16,
    uint16: m.UINT16,
    int32: m.INT32,
    uint32: m.UINT32,
    float: m.FLOAT,
    double: m.DOUBLE,
    string: m.STRING,
    bytes: m.BYTE
  };
  const mapped = table[type];
  if (!mapped && mapped !== 0) throw new Error(`不支持的内存类型: ${type}`);
  return mapped;
}
