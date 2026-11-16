#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function resolvePythonExecutable() {
  const candidates = [
    path.join(rootDir, '.venv', 'bin', 'python'),
    path.join(rootDir, '.venv', 'Scripts', 'python.exe'),
    'python3',
    'python',
  ];
  for (const candidate of candidates) {
    if (!candidate.includes(path.sep) || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'python3';
}

const pythonExe = resolvePythonExecutable();
const bridgeScript = path.join(rootDir, 'server', 'edupage_bridge.py');

console.log(`[dev-local] Starte EduPage-Bridge mit ${pythonExe}...`);
const bridgeProc = spawn(pythonExe, [bridgeScript], {
  cwd: rootDir,
  stdio: 'inherit',
});

const viteBin = path.join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite.cmd' : 'vite'
);

console.log('[dev-local] Starte Vite Frontend...');
const viteProc = spawn(viteBin, [], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

function shutdown(signal) {
  bridgeProc.kill(signal);
  viteProc.kill(signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

viteProc.on('exit', (code) => {
  bridgeProc.kill('SIGTERM');
  process.exit(code ?? 0);
});

bridgeProc.on('exit', (code) => {
  if (code && code !== 0) {
    console.warn(`[dev-local] EduPage-Bridge wurde mit Code ${code} beendet. Frontend läuft weiter.`);
  }
});
