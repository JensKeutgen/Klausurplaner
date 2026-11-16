#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const venvDir = path.join(rootDir, '.venv');
const requirementsPath = path.join(rootDir, 'server', 'requirements.txt');

const systemPython = process.platform === 'win32' ? 'python' : 'python3';

if (!fs.existsSync(venvDir)) {
  console.log('[setup:edupage] Erstelle lokale Python-Umgebung (.venv)...');
  const res = spawnSync(systemPython, ['-m', 'venv', venvDir], { cwd: rootDir, stdio: 'inherit' });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

const venvPython =
  process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

console.log('[setup:edupage] Installiere edupage-api...');
const pipRes = spawnSync(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath], {
  cwd: rootDir,
  stdio: 'inherit',
});

if (pipRes.status !== 0) {
  process.exit(pipRes.status ?? 1);
}

console.log('[setup:edupage] Fertig! Starte die App jetzt mit: npm run dev:local');
