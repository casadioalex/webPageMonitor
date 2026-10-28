import fs from 'node:fs';
import { P } from './paths.js';

export interface Viewport { name: string; width: number; height: number }
export interface ElementCfg { name: string; selector: string }
export interface PageCfg {
  name: string; path: string; elements?: ElementCfg[]; autoElements?: boolean; maskSelectors?: string[]; viewports?: Viewport[];
  visual?: Partial<Defaults['visual']>; geometryTolerancePx?: number; enabled?: boolean;
}
export interface SiteCfg { id: string; name: string; enabled?: boolean; pilot?: boolean; baseUrl: string; pages: PageCfg[] }
export interface Defaults {
  viewports: Viewport[]; navTimeoutMs: number; retries: number;
  visual: { pixelmatchThreshold: number; maxDiffRatio: number; criticalDiffRatio: number };
  geometryTolerancePx: number; globalMaskSelectors: string[];
  elements?: ElementCfg[]; autoElements?: boolean; autoMaxElements?: number;
}
export interface Config { defaults: Defaults; run: { concurrency: number; maxRunMinutes: number; retentionDays: number; keepRuns?: number  }; sites: SiteCfg[] }

export function loadConfig(): Config {
  if (!fs.existsSync(P.sites)) throw new Error(`File mancante: ${P.sites}`);
  const cfg = JSON.parse(fs.readFileSync(P.sites, 'utf8')) as Config;
  const ids = new Set<string>();
  for (const s of cfg.sites) {
    if (!s.id || !/^[a-z0-9-]+$/.test(s.id)) throw new Error(`ID sito non valido: "${s.id}" (usa a-z, 0-9, -)`);
    if (ids.has(s.id)) throw new Error(`ID sito duplicato: ${s.id}`);
    ids.add(s.id);
    new URL(s.baseUrl); // lancia se non valido
    const names = new Set<string>();
    for (const p of s.pages) {
      if (names.has(p.name)) throw new Error(`Pagina duplicata "${p.name}" nel sito ${s.id}`);
      names.add(p.name);
    }
  }
  return cfg;
}
