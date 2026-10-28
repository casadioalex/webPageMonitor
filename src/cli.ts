import 'dotenv/config';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { loadConfig } from './config.js';
import { db } from './database/db.js';
import { runScan, scheduledRunMissing, buildTasks } from './scan.js';
import { approveBaselines } from './baseline.js';
import { addException, listExceptions, revokeException, type ExKind } from './memory/exceptions.js';
import { writeReport } from './reports/html.js';
import { log } from './util.js';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i < 0 ? undefined : (argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? 'true' : argv[i + 1]); };
const [cmd, sub] = argv;

async function main() {
  switch (cmd) {
    case 'scan': {
      const scheduled = flag('scheduled') === 'true', ifMissed = flag('if-missed') === 'true';
      if (ifMissed && !scheduledRunMissing()) { log('INFO', 'Nessun recupero necessario.'); return; }
      const id = await runScan({ trigger: ifMissed ? 'catchup' : scheduled ? 'scheduled' : 'manual', pilot: flag('pilot') === 'true', siteIds: flag('site')?.split(',') });
      if (id === null) process.exitCode = 2;
      break;
    }
    case 'baseline': {
      if (sub !== 'approve') throw new Error('Uso: baseline approve --site ID [--page NOME] [--run N] --yes');
      if (flag('yes') !== 'true') throw new Error('Per approvare una baseline devi aggiungere --yes (conferma esplicita). Controlla prima gli screenshot nel report.');
      const site = flag('site'); if (!site) throw new Error('--site obbligatorio');
      const done = approveBaselines({ siteId: site, page: flag('page'), runId: flag('run') ? Number(flag('run')) : undefined });
      console.log(`Baseline approvate (${done.length}):\n` + done.join('\n'));
      break;
    }
    case 'exceptions': {
      if (sub === 'add') {
        const need = (k: string) => flag(k) ?? (() => { throw new Error(`--${k} obbligatorio`); })();
        const id = addException({ siteId: need('site'), url: need('url'), viewport: flag('viewport'), selector: flag('selector'), kind: need('kind') as ExKind, reason: need('reason'), threshold: flag('threshold') ? Number(flag('threshold')) : undefined });
        console.log(`Eccezione #${id} salvata.`);
      } else if (sub === 'revoke') { revokeException(Number(argv[2]), flag('note') ?? ''); console.log('Revocata.'); }
      else if (sub === 'list') console.table(listExceptions(flag('all') === 'true'));
      else if (sub === 'history') console.table(db().prepare(`SELECT * FROM exception_history ORDER BY id`).all());
      else throw new Error('Uso: exceptions add|list|revoke|history');
      break;
    }
    case 'report': {
      const id = flag('run') ? Number(flag('run')) : (db().prepare(`SELECT MAX(id) m FROM runs`).get() as { m: number | null }).m;
      if (!id) throw new Error('Nessuna run.'); console.log(writeReport(id)); break;
    }
    case 'list-sites': {
      const cfg = loadConfig(); const t = buildTasks(cfg, { pilot: flag('pilot') === 'true' });
      console.log(`${cfg.sites.length} siti, ${t.length} controlli pagina×viewport`); console.table(cfg.sites.map((s) => ({ id: s.id, enabled: s.enabled !== false, pilot: !!s.pilot, pagine: s.pages.length })));
      break;
    }
    case 'check-install': {
      const ok = (b: boolean, m: string) => { console.log(`${b ? 'OK  ' : 'FAIL'} ${m}`); if (!b) process.exitCode = 1; };
      ok(Number(process.versions.node.split('.')[0]) >= 20, `Node ${process.versions.node} (richiesto >= 20)`);
      try { const c = loadConfig(); ok(true, `sites.json valido (${c.sites.length} siti)`); } catch (e) { ok(false, `sites.json: ${(e as Error).message}`); }
      try { db().prepare('SELECT 1').get(); ok(true, 'Database SQLite apribile'); } catch (e) { ok(false, `SQLite: ${(e as Error).message}`); }
      ok(fs.existsSync(chromium.executablePath()), 'Chromium installato (altrimenti: npm run install:browser)');
      break;
    }
    default:
      console.log('Comandi: scan [--pilot] [--site id,id] [--if-missed] | baseline approve --site ID --yes | exceptions add|list|revoke|history | report | list-sites | check-install');
  }
}
main().catch((e) => { log('ERROR', e.message); process.exitCode = 1; });
