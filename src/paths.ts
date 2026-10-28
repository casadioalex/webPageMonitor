import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const P = {
  sites: path.join(ROOT, 'sites.json'),
  data: path.join(ROOT, 'data'),
  db: process.env.MONITOR_DB_PATH ?? path.join(ROOT, 'data', 'monitor.db'),
  lock: path.join(ROOT, 'data', 'scan.lock'),
  baselines: path.join(ROOT, 'baselines'),
  screenshots: path.join(ROOT, 'screenshots'),
  reports: path.join(ROOT, 'reports'),
  logs: path.join(ROOT, 'logs'),
};
