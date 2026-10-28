import Database from 'better-sqlite3';
import { P } from '../paths.js';
import { ensureDir } from '../util.js';

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  ensureDir(P.data);
  _db = new Database(P.db);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(`
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL,            -- manual | scheduled | catchup
  rome_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',  -- running | completed | partial | aborted
  note TEXT
);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  site_id TEXT NOT NULL, page TEXT NOT NULL, url TEXT NOT NULL, viewport TEXT NOT NULL,
  check_type TEXT NOT NULL,         -- connection | visual | geometry
  status TEXT NOT NULL,             -- passed | failed | not_verifiable | not_executed
  severity TEXT NOT NULL,           -- none | info | review | critical
  summary TEXT NOT NULL,
  details TEXT,                     -- JSON
  images TEXT                       -- JSON {baseline,current,diff} (percorsi relativi a ROOT)
);
CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id);
CREATE TABLE IF NOT EXISTS exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL, url TEXT NOT NULL,   -- URL normalizzato
  viewport TEXT,                              -- NULL = tutti i viewport di QUELLA pagina
  selector TEXT,                              -- NULL solo per visual-threshold
  kind TEXT NOT NULL,                         -- text-change | visual-region | visual-threshold
  reason TEXT NOT NULL,
  threshold REAL,                             -- per visual-threshold: rapporto massimo autorizzato
  status TEXT NOT NULL DEFAULT 'active',      -- active | revoked
  decided_at TEXT NOT NULL, decided_by TEXT NOT NULL DEFAULT 'utente'
);
CREATE TABLE IF NOT EXISTS exception_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, exception_id INTEGER NOT NULL REFERENCES exceptions(id),
  action TEXT NOT NULL, at TEXT NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS baseline_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, page TEXT, viewport TEXT,
  from_run INTEGER, approved_at TEXT NOT NULL
);
`);
  return _db;
}
