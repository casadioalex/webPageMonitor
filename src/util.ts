import fs from 'node:fs';
import path from 'node:path';
import { P } from './paths.js';

export function ensureDir(d: string) { fs.mkdirSync(d, { recursive: true }); }

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
}

/** Normalizza un URL: host minuscolo, niente hash, niente utm_*, parametri ordinati, niente slash finale (tranne root). */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  const keep = [...u.searchParams.entries()].filter(([k]) => !/^(utm_|fbclid|gclid)/i.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Data e ora correnti nel fuso Europe/Rome. */
export function romeNow(d = new Date()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

// ---- log su file con rotazione giornaliera ----
export function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string) {
  ensureDir(P.logs);
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(P.logs, `${romeNow().date}.log`), line + '\n');
}

export function pruneOld(dir: string, days: number) {
  if (!fs.existsSync(dir)) return;
  const limit = Date.now() - days * 86400_000;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).mtimeMs < limit) fs.rmSync(full, { recursive: true, force: true });
  }
}

/** Unisce baseUrl e path mantenendo l'eventuale sottocartella del baseUrl (http://ip/test/stage/ + "pagina/"). */
export function joinUrl(baseUrl: string, pagePath: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  return new URL(pagePath.replace(/^\/+/, ''), base).toString();
}
