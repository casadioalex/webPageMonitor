# STATE — monitor-100-siti
Aggiornato: 2026-10-28 · Fase corrente: 1 completata (non collaudata) → prossima: collaudo 5 siti pilota, poi Fase 2

## Obiettivo
Monitoraggio esterno di ~100 siti WordPress (nessuna modifica ai siti, nessun plugin). Windows 11, 8 GB RAM, 4 GB VRAM. Report/email alle 09:00 Europe/Rome.

## Decisioni (non rimetterle in discussione)
- Playwright come libreria (non Playwright Test), TypeScript ESM, esecuzione con tsx
- SQLite via better-sqlite3 in data/monitor.db; config in sites.json; segreti in .env
- Elementi: manuali (`elements`) + automatici (`autoElements`, default attivo); auto = severità max 'review'
- Concurrency 1 (8 GB RAM); retry e timeout configurabili in sites.json
- Baseline SOLO con `baseline approve --yes`, mai automatiche
- Eccezioni per sito + URL normalizzato + viewport; approvate solo dall'utente; mai modifica baseline
- `text-change` sopprime solo il testo, mai missing/hidden/moved/resized/overlap
- Stati risultato: passed | failed | not_verifiable | not_executed (mai mescolarli)
- IA visiva solo via API esterna, solo per anomalie dubbie, disattivabile (Fase 3)

## Struttura
- src/cli.ts: comandi (scan, baseline, exceptions, report, list-sites, check-install)
- src/scan.ts: run, coda, retry, lock, recupero (`scheduledRunMissing`)
- src/baseline.ts: approvazione manuale
- src/config.ts, paths.ts, util.ts, lock.ts, types.d.ts
- src/visual/capture.ts (screenshot full page deterministico) · compare.ts (pixelmatch + diff)
- src/layout/geometry.ts: snapshot DOM/CSS, confronto, sovrapposizioni
- src/memory/exceptions.ts: CRUD eccezioni, `activeFor`, `suppressFindings`
- src/reports/html.ts: report reports/<run>/index.html
- src/database/db.ts: tabelle runs, results, exceptions, exception_history, baseline_history
- scripts/run-scan.cmd, scripts/register-tasks.ps1 (task 09:00 + recupero all'accesso)
- tests/unit.test.ts (3 test) · sites.json (2 siti fittizi .example) · README.md · .env.example

## Dipendenze
runtime: better-sqlite3, playwright, pixelmatch, pngjs, dotenv
dev: tsx, typescript, @types/node, @types/better-sqlite3, @types/pngjs
Chromium: `npm run install:browser`

## Comandi
npm run check | scan | scan:pilot | sites | report | test:unit
npm run baseline -- approve --site ID [--page N] [--run N] --yes
npm run exceptions -- add|list|revoke|history

## Verifica
- [verificato] tsc senza errori; 5 unit test passati (inclusi joinUrl e collasso a cascata)
- [NON verificato] collectAuto nel browser, scansione reale con Chromium, screenshot/diff, geometria su siti veri, report, Task Scheduler, recupero scansione mancata

## Da fare (in ordine)
1. Collaudo Fase 1 su 5 siti pilota (utente: URL reali in sites.json, `npm run check`, `scan:pilot`, approvare baseline, riscansione)
2. Fase 2: test form (safe / staging / live-approved), CAPTCHA mai aggirato, dati di prova configurabili
3. Fase 3: IA visiva (provider configurabile, limite costi, JSON strutturato, contenuti pagina trattati come dati) + proposta eccezioni con approvazione utente; email SMTP HTML+testo, mail di prova, avvisi critici
4. Fase 4: crawler/sitemap (limiti, no admin/logout), pannello web locale protetto
5. Verifiche pilota: eccezioni persistono al riavvio, un'eccezione non nasconde altri problemi, RAM sotto controllo

## Problemi noti / limiti
- Ambiente di prova: http://192.168.0.252/test/stage_alex/ (sites.json: id stage-alex)
- Auto-elementi identificati per posizione nell'HTML: cambi di struttura generano missing/nuovi
- Chromium non scaricabile nell'ambiente di sviluppo di Claude: il codice runtime va provato sul PC dell'utente
- visual-region cambia l'area mascherata: dopo averla aggiunta riapprovare la baseline di quella pagina
- Il confronto pixel su pagine di altezza diversa usa l'area comune; la differenza di altezza è segnalata a parte
- Task Scheduler usa l'ora locale di Windows: fuso richiesto "W. Europe Standard Time"

## Config esterna a carico dell'utente (non inventare)
URL reali dei siti, selettori elementi, SMTP e destinatari, chiave API IA, dati/endpoint di test per i form
