// 游戏内存读写 stub (Cheat Engine 风格)
// 依赖原生模块 memoryjs (Windows only), 用户需要时单独安装
// 目前提供权限校验 + 接口框架
import { checkMemoryRW } from '../permissions';

export interface ProcessInfo {
  pid: number;
  name: string;
}

let _memoryjs: any = null;
async function tryLoad() {
  if (_memoryjs) return _memoryjs;
  try {
    _memoryjs = await import('memoryjs' as any);
    return _memoryjs;
  } catch {
    return null;
  }
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  const decision = checkMemoryRW();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  const m = await tryLoad();
  if (!m) throw new Error('memoryjs 尚未安装. 请在设置中点击"安装游戏内存读写"按钮.');
  return new Promise((resolve, reject) => {
    m.default.getProcesses((err: any, processes: any[]) => {
      if (err) reject(err);
      else resolve(processes.map((p) => ({ pid: p.th32ProcessID, name: p.szExeFile })));
    });
  });
}

export async function isMemoryRWInstalled(): Promise<boolean> {
  return (await tryLoad()) !== null;
}

// 真正的读/写/扫描功能在用户安装并测试后再补完
// 这里保留 stub, 防止配置不当时直接调用崩溃
