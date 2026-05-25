#!/usr/bin/env node
const { spawn } = require('child_process');
const { join } = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
for (const key of Object.keys(env)) {
  if (env[key] === undefined) delete env[key];
}

const bin = process.platform === 'win32'
  ? join(__dirname, '..', 'node_modules', '.bin', 'electron-vite.cmd')
  : join(__dirname, '..', 'node_modules', '.bin', 'electron-vite');

const child = spawn(bin, ['preview'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
