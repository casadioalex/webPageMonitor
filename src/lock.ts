import fs from 'node:fs';
import { P } from './paths.js';
import { ensureDir } from './util.js';

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Ritorna false se un'altra scansione è in corso. Lock obsoleti (processo morto) vengono rimossi. */
export function acquireLock(): boolean {
  ensureDir(P.data);
  if (fs.existsSync(P.lock)) {
    try {
      const { pid } = JSON.parse(fs.readFileSync(P.lock, 'utf8'));
      if (alive(pid)) return false;
    } catch { /* lock corrotto: lo sostituiamo */ }
    fs.rmSync(P.lock, { force: true });
  }
  try {
    fs.writeFileSync(P.lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: 'wx' });
    return true;
  } catch { return false; }
}

export function releaseLock() { fs.rmSync(P.lock, { force: true }); }
