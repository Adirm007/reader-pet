// 能力注册表 — 供 UI 展示当前可用 / 不可用的能力
import type { CapabilityDescriptor } from '../../shared/types';

export const CAPABILITIES: CapabilityDescriptor[] = [
  {
    id: 'file_read',
    display_name: '文件读取',
    description: '读取文本文件内容',
    risk_level: 'low',
    available_in_safe: true,
    available_in_danger: true
  },
  {
    id: 'file_write',
    display_name: '文件写入',
    description: '创建或覆盖文本文件',
    risk_level: 'medium',
    available_in_safe: true,
    available_in_danger: true
  },
  {
    id: 'shell_exec',
    display_name: 'Shell 命令执行',
    description: '执行 shell / PowerShell 命令',
    risk_level: 'high',
    available_in_safe: true,
    available_in_danger: true
  },
  {
    id: 'screen_capture',
    display_name: '屏幕截图',
    description: '截取屏幕内容. 在多模态模型下可直接用于视觉理解',
    risk_level: 'high',
    available_in_safe: true,
    available_in_danger: true
  },
  {
    id: 'browser',
    display_name: '浏览器自动化',
    description: '通过 Playwright 操控浏览器, 读取 / 改写网页元素',
    risk_level: 'critical',
    available_in_safe: false,
    available_in_danger: true,
    requires_extra_enable: true
  },
  {
    id: 'memory_rw',
    display_name: '游戏内存读写',
    description: 'Cheat Engine 风格的进程内存读写. 仅限单机游戏自用',
    risk_level: 'critical',
    available_in_safe: false,
    available_in_danger: true,
    requires_extra_enable: true
  }
];
