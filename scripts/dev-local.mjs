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
const bridgeProc = spawn(pythonExe, ['-u', bridgeScript], {
  cwd: rootDir,
  stdio: 'inherit',
});

const tsxEntry = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const mcpScript = path.join(rootDir, 'server', 'mcp.ts');
let mcpProc = null;

if (fs.existsSync(tsxEntry) && fs.existsSync(mcpScript)) {
  console.log('[dev-local] Starte Klausurplaner MCP-Server (http://127.0.0.1:8788/mcp)...');
  mcpProc = spawn(process.execPath, [tsxEntry, mcpScript], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  mcpProc.on('exit', (code) => {
    if (code && code !== 0) {
      console.warn(`[dev-local] MCP-Server wurde mit Code ${code} beendet. Frontend läuft weiter.`);
    }
  });
} else {
  console.warn('[dev-local] Hinweis: tsx nicht gefunden, MCP-Server wird nicht gestartet (npm install ausführen).');
}

const viteEntry = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');

console.log('[dev-local] Starte Vite Frontend...');
const viteProc = fs.existsSync(viteEntry)
  ? spawn(process.execPath, [viteEntry], {
      cwd: rootDir,
      stdio: 'inherit',
    })
  : spawn(
      path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite'),
      [],
      {
        cwd: rootDir,
        stdio: 'inherit',
        shell: false,
      }
    );

function shutdown(signal) {
  if (!bridgeProc.killed) bridgeProc.kill(signal);
  if (mcpProc && !mcpProc.killed) mcpProc.kill(signal);
  if (!viteProc.killed) viteProc.kill(signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

viteProc.on('exit', (code) => {
  bridgeProc.kill('SIGTERM');
  if (mcpProc && !mcpProc.killed) mcpProc.kill('SIGTERM');
  process.exit(code ?? 0);
});

bridgeProc.on('exit', (code) => {
  if (code && code !== 0) {
    console.warn(`[dev-local] EduPage-Bridge wurde mit Code ${code} beendet. Frontend läuft weiter.`);
  }
});
