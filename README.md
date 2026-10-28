# monitor-100-siti — Fase 1

Monitoraggio esterno di siti WordPress con Playwright (libreria) + TypeScript + SQLite. Non modifica i siti monitorati.

## Stato dei moduli
| Modulo | Stato |
|---|---|
| Config siti (`sites.json`), SQLite, lock anti-doppia-esecuzione, log giornalieri | Fase 1 (fatto) |
| Screenshot full page desktop/mobile, confronto pixel, immagini diff, maschere | Fase 1 (fatto, non provato su siti reali) |
| Controllo geometria/CSS (posizione, dimensioni, stili, testo, sovrapposizioni) | Fase 1 (fatto, non provato su siti reali) |
| Baseline: approvazione solo manuale (`--yes`) | Fase 1 (fatto) |
| Memoria eccezioni per pagina (aggiunta, lista, revoca, storico) | Fase 1 (fatto, testato con unit test) |
| Report HTML locale per run | Fase 1 (fatto) |
| Task Scheduler 09:00 + recupero | Fase 1 (script pronti, da registrare sul tuo PC) |
| Test dei form (safe/staging/live-approved) | Fase 2 (mancante) |
| Analisi IA visiva, proposta eccezioni | Fase 3 (mancante) |
| Email SMTP giornaliera e avvisi critici | Fase 3 (mancante) |
| Crawler/sitemap | Fase 4 (mancante) |
| Pannello web locale | Fase 4 (mancante) |

## Installazione (Windows 11)
1. Installa Node.js LTS da https://nodejs.org (versione >= 20). Riapri PowerShell e verifica `node -v`.
2. Nella cartella del progetto: `npm install`
3. `npm run install:browser` (scarica Chromium)
4. `npm run check` — deve stampare OK su tutte le righe.
5. `npm run test:unit` — 3 test devono passare.

Nota: `better-sqlite3` usa binari precompilati. Se `npm install` prova a compilare e fallisce, installa gli "Strumenti di compilazione C++" di Visual Studio oppure usa Node LTS.

## Primo test sui siti pilota
1. Modifica `sites.json` con i tuoi URL reali (gli esempi `.example` non esistono). Imposta `"pilot": true` su 5 siti.
2. `npm run sites -- --pilot` per vedere quanti controlli verranno eseguiti.
3. `npm run scan:pilot`. Alla prima esecuzione tutti i controlli visivi e geometrici risultano **non verificabili** (nessuna baseline): è corretto.
4. Apri `reports\<run>\index.html` e guarda gli screenshot.
5. Se sono corretti: `npm run baseline -- approve --site ID --yes` (opzionale `--page NOME`, `--run N`).
6. Riesegui la scansione: ora i confronti vengono fatti.

## Configurare sito, pagina, elementi
Vedi gli esempi in `sites.json`: `elements` (nome + selettore CSS/locator) per il controllo geometrico, `maskSelectors` per escludere solo aree variabili, `viewports` e soglie per singola pagina.

## Eccezioni (falsi allarmi) per singola pagina
```
npm run exceptions -- add --site esempio-uno --url https://esempio-uno.example/contatti/ --viewport desktop --selector ".banner-promo" --kind text-change --reason "contenuto promozionale dinamico"
npm run exceptions -- list
npm run exceptions -- revoke 1 --note "non più valida"
npm run exceptions -- history
```
Tipi: `text-change` (ignora solo il cambio di testo di quel selettore; elemento mancante/nascosto/spostato/sovrapposto resta segnalato), `visual-region` (maschera solo quell'area negli screenshot futuri), `visual-threshold` (soglia pixel autorizzata per quella pagina, con `--threshold 0.03`). Ogni eccezione vale solo per sito + URL normalizzato + viewport. Non modifica mai le baseline.
Attenzione: una `visual-region` mascherata cambia l'area confrontata, quindi dopo averla aggiunta riapprova la baseline di quella pagina, altrimenti il confronto vedrà la maschera come differenza.

## Pianificazione alle 09:00
PowerShell: `powershell -ExecutionPolicy Bypass -File scripts\register-tasks.ps1`
Crea due attività: una giornaliera alle 09:00 (con "avvia appena possibile se mancata") e una all'accesso che esegue `scan --if-missed`, che parte solo se oggi dopo le 09:00 non esiste una run completata. Il fuso di Windows deve essere "W. Europe Standard Time" per avere le 09:00 italiane con l'ora legale automatica. Se il PC è spento, la scansione mancata non viene mai segnata come eseguita.
Avvio manuale: `npm run scan`. Un secondo avvio mentre ne gira uno viene rifiutato dal lock.

## Troubleshooting
- `check` dice Chromium mancante: `npm run install:browser`.
- Tutto "Pagina non raggiungibile": verifica rete/proxy, e che l'URL in `sites.json` sia reale.
- Molti falsi allarmi visivi: aumenta `maxDiffRatio` per quella pagina, aggiungi `maskSelectors`, oppure un'eccezione.
- Lock bloccato dopo un crash: viene ripulito da solo se il processo non esiste più; altrimenti elimina `data\scan.lock`.
- RAM: tieni `concurrency` a 1 con 8 GB.

## Aggiungere pagine ed elementi
- Nuova pagina = una riga in `pages`: `{ "name": "how-it-works", "path": "how-it-works/" }`. `baseUrl` con slash finale; `path` relativo (lo slash iniziale viene ignorato).
- Elementi: `defaults.autoElements: true` analizza automaticamente landmark (header, nav, main, footer, aside, section, article), h1-h3, form, immagini, pulsanti e campi (max `autoMaxElements`, default 150). Si può disattivare per pagina con `"autoElements": false`.
- `elements` (a mano) e `defaults.elements` (lista comune a tutte le pagine) si sommano agli automatici. Solo gli elementi manuali sono controllati per sovrapposizioni e segnalati come critici se spariscono; gli automatici sono "da verificare".
- Limite: gli elementi automatici sono identificati dalla posizione nell'HTML (id se presente, altrimenti nth-of-type). Se la struttura cambia, alcuni risulteranno mancanti e altri nuovi (i nuovi non sono segnalati finché non riapprovi la baseline). Gli spostamenti a cascata sono raggruppati in un solo avviso.
