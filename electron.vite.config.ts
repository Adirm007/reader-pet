import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { builtinModules } from 'module';
import { resolve } from 'path';

const external = ['electron', ...builtinModules.flatMap((m) => [m, `node:${m}`])];

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main')
      }
    },
    build: {
      externalizeDeps: { include: ['memoryjs', 'playwright'] },
      rolldownOptions: {
        input: resolve('src/main/index.ts'),
        external
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        input: resolve('src/preload/index.ts'),
        external
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    }
  }
});
