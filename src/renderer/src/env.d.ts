/// <reference types="vite/client" />

// 渲染端使用的 API 类型声明
import type { PetAPI } from '../../preload';

declare global {
  interface Window {
    api: PetAPI;
  }
}

export {};
