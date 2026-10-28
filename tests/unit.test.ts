import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.MONITOR_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mon-')), 't.db');

const { normalizeUrl } = await import('../src/util.js');
const { addException, activeFor, revokeException, suppressFindings } = await import('../src/memory/exceptions.js');
const { compareSnapshots } = await import('../src/layout/geometry.js');

test('normalizeUrl', () => {
  assert.equal(normalizeUrl('HTTPS://Esempio.IT/contatti/?utm_source=x&b=2&a=1#top'), 'https://esempio.it/contatti?a=1&b=2');
});

test('eccezione limitata a sito+URL+viewport', () => {
  const id = addException({ siteId: 's1', url: 'https://esempio.it/contatti/', viewport: 'desktop', selector: '.promo', kind: 'text-change', reason: 'banner dinamico' });
  assert.equal(activeFor('s1', 'https://esempio.it/contatti', 'desktop').length, 1);
  assert.equal(activeFor('s1', 'https://esempio.it/contatti', 'mobile').length, 0);
  assert.equal(activeFor('s2', 'https://esempio.it/contatti', 'desktop').length, 0);
  assert.equal(activeFor('s1', 'https://esempio.it/altra', 'desktop').length, 0);
  revokeException(id);
  assert.equal(activeFor('s1', 'https://esempio.it/contatti', 'desktop').length, 0);
});

test('text-change non nasconde elemento scomparso o spostato', () => {
  const el = (o: object) => ({ present: true, visible: true, x: 0, y: 0, w: 100, h: 50, text: 'a', style: { fontFamily: '', fontSize: '', fontWeight: '', color: '', backgroundColor: '', display: '', position: '', margin: '', padding: '' }, ...o });
  const base = { promo: el({}) };
  const ex = [{ id: 1, kind: 'text-change', selector: '.promo' }] as never;
  let f = suppressFindings(compareSnapshots(base, { promo: el({ text: 'b' }) }, 4, { promo: '.promo' }), ex);
  assert.equal(f.active.length, 0); assert.equal(f.suppressed.length, 1);
  f = suppressFindings(compareSnapshots(base, { promo: el({ present: false }) }, 4, { promo: '.promo' }), ex);
  assert.equal(f.active[0].kind, 'missing');
  f = suppressFindings(compareSnapshots(base, { promo: el({ text: 'b', y: 300 }) }, 4, { promo: '.promo' }), ex);
  assert.ok(f.active.some((x) => x.kind === 'moved'));
});

test('modalità auto: spostamenti a cascata raggruppati, missing = review', async () => {
  const { collapseCascade } = await import('../src/layout/geometry.js');
  const mk = (i: number) => ({ kind: 'moved' as const, element: `auto:x${i}`, severity: 'review' as const, message: 'm' });
  assert.equal(collapseCascade([1, 2, 3, 4, 5, 6, 7].map(mk)).length, 1);
  assert.equal(collapseCascade([1, 2].map(mk)).length, 2);
  const el = { present: true, visible: true, x: 0, y: 0, w: 100, h: 50, text: '', style: { fontFamily: '', fontSize: '', fontWeight: '', color: '', backgroundColor: '', display: '', position: '', margin: '', padding: '' } };
  const f = compareSnapshots({ 'auto:h1': el }, {}, 4, {});
  assert.equal(f[0].kind, 'missing'); assert.equal(f[0].severity, 'review');
});

test('joinUrl mantiene la sottocartella', async () => {
  const { joinUrl } = await import('../src/util.js');
  assert.equal(joinUrl('http://192.168.0.252/test/stage_alex/', 'how-it-works/'), 'http://192.168.0.252/test/stage_alex/how-it-works/');
  assert.equal(joinUrl('http://192.168.0.252/test/stage_alex', '/contatti/'), 'http://192.168.0.252/test/stage_alex/contatti/');
  assert.equal(joinUrl('https://x.it', '/'), 'https://x.it/');
});
