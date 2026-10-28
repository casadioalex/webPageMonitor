import { db } from '../database/db.js';
import { normalizeUrl } from '../util.js';

export type ExKind = 'text-change' | 'visual-region' | 'visual-threshold';
export interface Exception {
  id: number; site_id: string; url: string; viewport: string | null; selector: string | null;
  kind: ExKind; reason: string; threshold: number | null; status: 'active' | 'revoked'; decided_at: string;
}

export function addException(e: { siteId: string; url: string; viewport?: string; selector?: string; kind: ExKind; reason: string; threshold?: number }): number {
  if (!e.reason.trim()) throw new Error('La motivazione è obbligatoria.');
  if (e.kind !== 'visual-threshold' && !e.selector) throw new Error(`kind=${e.kind} richiede --selector (le eccezioni devono essere circoscritte).`);
  if (e.kind === 'visual-threshold' && !(e.threshold && e.threshold > 0 && e.threshold < 1)) throw new Error('visual-threshold richiede --threshold tra 0 e 1 (es. 0.03).');
  const now = new Date().toISOString();
  const r = db().prepare(`INSERT INTO exceptions (site_id,url,viewport,selector,kind,reason,threshold,decided_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(e.siteId, normalizeUrl(e.url), e.viewport ?? null, e.selector ?? null, e.kind, e.reason, e.threshold ?? null, now);
  db().prepare(`INSERT INTO exception_history (exception_id,action,at,note) VALUES (?,?,?,?)`).run(r.lastInsertRowid, 'created', now, e.reason);
  return Number(r.lastInsertRowid);
}

export function revokeException(id: number, note = '') {
  const now = new Date().toISOString();
  const r = db().prepare(`UPDATE exceptions SET status='revoked' WHERE id=? AND status='active'`).run(id);
  if (!r.changes) throw new Error(`Eccezione ${id} non trovata o già revocata.`);
  db().prepare(`INSERT INTO exception_history (exception_id,action,at,note) VALUES (?,?,?,?)`).run(id, 'revoked', now, note);
}

export function listExceptions(all = false): Exception[] {
  return db().prepare(`SELECT * FROM exceptions ${all ? '' : "WHERE status='active'"} ORDER BY id`).all() as Exception[];
}

/** Eccezioni attive valide SOLO per quel sito + URL normalizzato + viewport (o viewport NULL = tutti i viewport della stessa pagina). */
export function activeFor(siteId: string, url: string, viewport: string): Exception[] {
  return db().prepare(`SELECT * FROM exceptions WHERE status='active' AND site_id=? AND url=? AND (viewport IS NULL OR viewport=?)`)
    .all(siteId, normalizeUrl(url), viewport) as Exception[];
}

import type { Finding } from '../layout/geometry.js';

/**
 * Applica le eccezioni approvate ai risultati geometrici.
 * Una eccezione 'text-change' sopprime SOLO i finding di tipo 'text' per lo stesso selettore:
 * elementi mancanti, nascosti, spostati, ridimensionati o sovrapposti restano sempre segnalati.
 */
export function suppressFindings(findings: Finding[], exs: Exception[]): { active: Finding[]; suppressed: (Finding & { exceptionId: number })[] } {
  const active: Finding[] = []; const suppressed: (Finding & { exceptionId: number })[] = [];
  for (const f of findings) {
    const ex = f.kind === 'text' ? exs.find((e) => e.kind === 'text-change' && e.selector === f.selector) : undefined;
    if (ex) suppressed.push({ ...f, exceptionId: ex.id }); else active.push(f);
  }
  return { active, suppressed };
}
