import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { loadConfig, type Config, type SiteCfg, type PageCfg, type Viewport } from './config.js';
import { db } from './database/db.js';
import { P, ROOT } from './paths.js';
import { acquireLock, releaseLock } from './lock.js';
import { log, romeNow, slug, normalizeUrl, pruneOld, ensureDir, joinUrl } from './util.js';
import { captureFullPage } from './visual/capture.js';
import { compareImages } from './visual/compare.js';
import { collectSnapshot, collectAuto, compareSnapshots, type Snapshot } from './layout/geometry.js';
import { activeFor, suppressFindings } from './memory/exceptions.js';
import { writeReport } from './reports/html.js';

export type Trigger = 'manual' | 'scheduled' | 'catchup';
type Status = 'passed' | 'failed' | 'not_verifiable' | 'not_executed';
type Severity = 'none' | 'info' | 'review' | 'critical';

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');

function record(runId: number, t: Task, check: string, status: Status, severity: Severity, summary: string, details?: unknown, images?: unknown) {
  db().prepare(`INSERT INTO results (run_id,site_id,page,url,viewport,check_type,status,severity,summary,details,images) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(runId, t.site.id, t.page.name, t.url, t.vp.name, check, status, severity, summary, details ? JSON.stringify(details) : null, images ? JSON.stringify(images) : null);
}

interface Task { site: SiteCfg; page: PageCfg; vp: Viewport; url: string }

export function buildTasks(cfg: Config, opts: { siteIds?: string[]; pilot?: boolean }): Task[] {
  const tasks: Task[] = [];
  for (const site of cfg.sites) {
    if (site.enabled === false) continue;
    if (opts.pilot && !site.pilot) continue;
    if (opts.siteIds?.length && !opts.siteIds.includes(site.id)) continue;
    for (const page of site.pages) {
      if (page.enabled === false) continue;
      const url = joinUrl(site.baseUrl, page.path);
      for (const vp of page.viewports ?? cfg.defaults.viewports) tasks.push({ site, page, vp, url });
    }
  }
  return tasks;
}

async function runTask(browser: Browser, runId: number, t: Task, cfg: Config) {
  const d = cfg.defaults;
  const visualCfg = { ...d.visual, ...(t.page.visual ?? {}) };
  const tol = t.page.geometryTolerancePx ?? d.geometryTolerancePx;
  const ctx = await browser.newContext({ viewport: { width: t.vp.width, height: t.vp.height }, locale: 'it-IT', timezoneId: 'Europe/Rome', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(d.navTimeoutMs);
  const jsErrors: string[] = [];
  page.on('pageerror', (e) => jsErrors.push(String(e.message).slice(0, 200)));
  try {
    // --- connessione ---
    let status = 0; let lastErr = '';
    for (let attempt = 0; attempt <= d.retries; attempt++) {
      try {
        const resp = await page.goto(t.url, { waitUntil: 'load', timeout: d.navTimeoutMs });
        status = resp?.status() ?? 0; lastErr = ''; break;
      } catch (e) { lastErr = (e as Error).message.split('\n')[0]; log('WARN', `${t.url} [${t.vp.name}] tentativo ${attempt + 1} fallito: ${lastErr}`); }
    }
    if (lastErr || status >= 400 || status === 0) {
      const msg = lastErr ? `Pagina non raggiungibile: ${lastErr}` : `HTTP ${status}`;
      record(runId, t, 'connection', 'failed', 'critical', msg, { status });
      record(runId, t, 'visual', 'not_executed', 'none', 'Saltato: pagina non raggiunta');
      record(runId, t, 'geometry', 'not_executed', 'none', 'Saltato: pagina non raggiunta');
      return;
    }
    record(runId, t, 'connection', 'passed', 'none', `HTTP ${status}`, { status, jsErrors });

    const exs = activeFor(t.site.id, t.url, t.vp.name);
    const masks = [...d.globalMaskSelectors, ...(t.page.maskSelectors ?? []), ...exs.filter((e) => e.kind === 'visual-region').map((e) => e.selector!)];
    const key = path.join(slug(t.site.id), slug(t.page.name));
    const curPng = path.join(P.screenshots, String(runId), key, `${t.vp.name}.png`);
    const basePng = path.join(P.baselines, key, `${t.vp.name}.png`);
    const baseGeo = path.join(P.baselines, key, `${t.vp.name}.geometry.json`);
    const diffPng = path.join(P.screenshots, String(runId), key, `${t.vp.name}.diff.png`);

    await captureFullPage(page, curPng, masks);

    // --- geometria (snapshot salvato sempre, confronto solo con baseline approvata) ---
    const elements = t.page.elements ?? d.elements ?? [];
    const auto = t.page.autoElements ?? d.autoElements ?? false;
    let curSnap: Snapshot = {};
    if (elements.length || auto) {
      curSnap = await collectSnapshot(page, elements);
      if (auto) Object.assign(curSnap, await collectAuto(page, d.autoMaxElements ?? 150));
      fs.writeFileSync(curPng.replace(/\.png$/, '.geometry.json'), JSON.stringify(curSnap, null, 2));
    }

    // --- visuale ---
    const images: Record<string, string> = { current: rel(curPng) };
    if (!fs.existsSync(basePng)) {
      record(runId, t, 'visual', 'not_verifiable', 'info', 'Nessuna baseline approvata: confronto impossibile', undefined, images);
    } else {
      images.baseline = rel(basePng);
      const r = compareImages(basePng, curPng, diffPng, visualCfg.pixelmatchThreshold);
      images.diff = rel(diffPng);
      const allowed = Math.max(visualCfg.maxDiffRatio, ...exs.filter((e) => e.kind === 'visual-threshold').map((e) => e.threshold ?? 0));
      const bad = r.ratio > allowed || Math.abs(r.heightDelta) > 40;
      const sev: Severity = !bad ? 'none' : r.ratio > visualCfg.criticalDiffRatio || Math.abs(r.heightDelta) > 400 ? 'critical' : 'review';
      record(runId, t, 'visual', bad ? 'failed' : 'passed', sev,
        `${(r.ratio * 100).toFixed(2)}% pixel diversi (soglia ${(allowed * 100).toFixed(2)}%)${r.sizeChanged ? `; dimensioni ${r.baseSize.join('×')} → ${r.curSize.join('×')}` : ''}`,
        { ...r, allowed, masks, appliedExceptions: exs.map((e) => e.id) }, images);
    }

    // --- geometria: confronto ---
    if (!elements.length && !auto) {
      record(runId, t, 'geometry', 'not_executed', 'none', 'Nessun elemento configurato per questa pagina');
    } else if (!fs.existsSync(baseGeo)) {
      record(runId, t, 'geometry', 'not_verifiable', 'info', 'Nessuno snapshot geometrico approvato');
    } else {
      const base = JSON.parse(fs.readFileSync(baseGeo, 'utf8')) as Snapshot;
      const sel = Object.fromEntries(elements.map((e) => [e.name, e.selector]));
      const { active, suppressed } = suppressFindings(compareSnapshots(base, curSnap, tol, sel), exs);
      const worst: Severity = active.some((f) => f.severity === 'critical') ? 'critical' : active.some((f) => f.severity === 'review') ? 'review' : active.length ? 'info' : 'none';
      const failed = worst === 'critical' || worst === 'review';
      record(runId, t, 'geometry', failed ? 'failed' : 'passed', worst,
        active.length ? `${active.length} differenze (${active.filter((f) => f.severity !== 'info').length} rilevanti)` : 'Nessuna differenza rilevante',
        { findings: active, suppressed, tolerancePx: tol });
    }
  } finally { await ctx.close(); }
}

export async function runScan(o: { trigger: Trigger; siteIds?: string[]; pilot?: boolean }): Promise<number | null> {
  const cfg = loadConfig();
  if (!acquireLock()) { log('WARN', 'Un\'altra scansione è già in corso: esco senza fare nulla.'); return null; }
  const database = db();
  const now = new Date();
  const runId = Number(database.prepare(`INSERT INTO runs (trigger,rome_date,started_at) VALUES (?,?,?)`).run(o.trigger, romeNow(now).date, now.toISOString()).lastInsertRowid);
  const finish = (status: string, note?: string) => database.prepare(`UPDATE runs SET status=?, finished_at=?, note=? WHERE id=?`).run(status, new Date().toISOString(), note ?? null, runId);
  const onSig = () => { finish('aborted', 'Interrotta dall\'utente'); releaseLock(); process.exit(130); };
  process.on('SIGINT', onSig); process.on('SIGTERM', onSig);

  let browser: Browser | null = null;
  try {
    const tasks = buildTasks(cfg, o);
    log('INFO', `Run ${runId} (${o.trigger}) avviata: ${tasks.length} controlli pagina×viewport`);
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    const deadline = Date.now() + cfg.run.maxRunMinutes * 60_000;
    const queue = [...tasks]; let skipped = 0;
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        if (Date.now() > deadline) {
          skipped++; db().prepare(`INSERT INTO results (run_id,site_id,page,url,viewport,check_type,status,severity,summary) VALUES (?,?,?,?,?,?,?,?,?)`)
            .run(runId, t.site.id, t.page.name, t.url, t.vp.name, 'connection', 'not_executed', 'review', 'Tempo massimo della run esaurito: non eseguito'); continue;
        }
        try { await runTask(browser!, runId, t, cfg); }
        catch (e) { log('ERROR', `${t.url} [${t.vp.name}]: ${(e as Error).message}`); record(runId, t, 'connection', 'not_executed', 'review', `Errore interno: ${(e as Error).message.split('\n')[0]}`); }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, cfg.run.concurrency) }, worker));
    finish(skipped ? 'partial' : 'completed', skipped ? `${skipped} controlli non eseguiti per limite di tempo` : undefined);
    const report = writeReport(runId);
    log('INFO', `Run ${runId} terminata. Report: ${report}`);
    pruneOld(P.screenshots, cfg.run.retentionDays); pruneOld(P.reports, cfg.run.retentionDays); pruneOld(P.logs, 90);
    return runId;
  } catch (e) {
    finish('aborted', (e as Error).message); log('ERROR', `Run ${runId} abortita: ${(e as Error).message}`); throw e;
  } finally {
    await browser?.close().catch(() => {}); releaseLock();
  }
}

/** true se oggi (Europe/Rome), dopo le 09:00, non esiste ancora una run programmata/di recupero. */
export function scheduledRunMissing(): boolean {
  const { date, hour } = romeNow();
  if (hour < 9) return false;
  const row = db().prepare(`SELECT COUNT(*) c FROM runs WHERE rome_date=? AND trigger IN ('scheduled','catchup') AND status IN ('completed','partial')`).get(date) as { c: number };
  return row.c === 0;
}
export { normalizeUrl, ensureDir };
