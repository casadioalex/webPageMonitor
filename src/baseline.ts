import fs from 'node:fs';
import path from 'node:path';
import { db } from './database/db.js';
import { P } from './paths.js';
import { slug } from './util.js';

/** Copia gli screenshot/snapshot di una run nelle baseline. Operazione SOLO manuale ed esplicita. */
export function approveBaselines(o: { siteId: string; page?: string; runId?: number }): string[] {
  const runId = o.runId ?? (db().prepare(`SELECT MAX(id) m FROM runs WHERE status IN ('completed','partial')`).get() as { m: number | null }).m;
  if (!runId) throw new Error('Nessuna run disponibile: esegui prima "npm run scan".');
  const siteDir = path.join(P.screenshots, String(runId), slug(o.siteId));
  if (!fs.existsSync(siteDir)) throw new Error(`La run ${runId} non contiene screenshot per il sito "${o.siteId}".`);
  const approved: string[] = [];
  for (const pageDir of fs.readdirSync(siteDir)) {
    if (o.page && pageDir !== slug(o.page)) continue;
    const src = path.join(siteDir, pageDir); const dst = path.join(P.baselines, slug(o.siteId), pageDir);
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      if (f.endsWith('.diff.png') || !(f.endsWith('.png') || f.endsWith('.geometry.json'))) continue;
      fs.copyFileSync(path.join(src, f), path.join(dst, f));
      if (f.endsWith('.png')) {
        db().prepare(`INSERT INTO baseline_history (site_id,page,viewport,from_run,approved_at) VALUES (?,?,?,?,?)`).run(o.siteId, pageDir, f.replace('.png', ''), runId, new Date().toISOString());
        approved.push(`${o.siteId}/${pageDir}/${f}`);
      }
    }
  }
  if (!approved.length) throw new Error('Nessuna baseline approvata (pagina non trovata nella run?).');
  return approved;
}
