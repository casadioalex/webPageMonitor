import type { Page } from 'playwright';
import type { ElementCfg } from '../config.js';

export interface ElSnap {
  present: boolean; visible: boolean; x: number; y: number; w: number; h: number; text: string; selector?: string;
  style: { fontFamily: string; fontSize: string; fontWeight: string; color: string; backgroundColor: string; display: string; position: string; margin: string; padding: string };
}
export type Snapshot = Record<string, ElSnap>;

const EMPTY: ElSnap = { present: false, visible: false, x: 0, y: 0, w: 0, h: 0, text: '', style: { fontFamily: '', fontSize: '', fontWeight: '', color: '', backgroundColor: '', display: '', position: '', margin: '', padding: '' } };

export async function collectSnapshot(page: Page, elements: ElementCfg[]): Promise<Snapshot> {
  const snap: Snapshot = {};
  for (const el of elements) {
    const loc = page.locator(el.selector).first();
    if ((await page.locator(el.selector).count()) === 0) { snap[el.name] = { ...EMPTY }; continue; }
    snap[el.name] = await loc.evaluate((node) => {
      const r = node.getBoundingClientRect(); const cs = getComputedStyle(node);
      return {
        present: true,
        visible: cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0 && r.width > 0 && r.height > 0,
        x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height),
        text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
        style: { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, backgroundColor: cs.backgroundColor, display: cs.display, position: cs.position, margin: cs.margin, padding: cs.padding },
      };
    }, undefined, { timeout: 5000 });
  }
  return snap;
}

/**
 * Scoperta automatica degli elementi strutturali (landmark, titoli, form, immagini, pulsanti, campi).
 * Una sola evaluate nel browser. Il nome/chiave è "auto:" + selettore CSS (id se presente, altrimenti percorso nth-of-type).
 */
export async function collectAuto(page: Page, max = 150): Promise<Snapshot> {
  const items = await page.evaluate((limit) => {
    const SEL = 'header,nav,main,footer,aside,section,article,h1,h2,h3,form,img,button,input,select,textarea,[role="banner"],[role="navigation"],[role="main"],[role="contentinfo"]';
    const css = (el: Element): string => {
      const parts: string[] = []; let n: Element | null = el; let anchored = false;
      while (n && n !== document.body) {
        if (n.id && /^[A-Za-z][\w-]*$/.test(n.id) && !/(?=[0-9a-f]*\d)[0-9a-f]{8,}/i.test(n.id)) { parts.unshift('#' + n.id); anchored = true; break; }
        const p: Element | null = n.parentElement; const cur: Element = n;
        const idx = p ? Array.from(p.children).filter((c) => c.tagName === cur.tagName).indexOf(cur) + 1 : 1;
        parts.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${idx})`); n = p;
      }
      return (anchored ? '' : 'body > ') + parts.join(' > ');
    };
    const out: Record<string, unknown>[] = []; const seen = new Set<string>();
    for (const node of Array.from(document.querySelectorAll(SEL))) {
      if (out.length >= limit) break;
      const r = node.getBoundingClientRect(); const cs = getComputedStyle(node);
      if (r.width < 5 || r.height < 5 || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      const selector = css(node); if (seen.has(selector)) continue; seen.add(selector);
      out.push({
        selector, present: true, visible: true,
        x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height),
        text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
        style: { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, backgroundColor: cs.backgroundColor, display: cs.display, position: cs.position, margin: cs.margin, padding: cs.padding },
      });
    }
    return out;
  }, max);
  const snap: Snapshot = {};
  for (const it of items as unknown as (ElSnap & { selector: string })[]) snap['auto:' + it.selector] = it;
  return snap;
}

export interface Finding { kind: 'missing' | 'hidden' | 'moved' | 'resized' | 'style' | 'text' | 'overlap'; element: string; severity: 'review' | 'critical' | 'info'; message: string; selector?: string }

const inter = (a: ElSnap, b: ElSnap) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const isAuto = (n: string) => n.startsWith('auto:');

export function compareSnapshots(base: Snapshot, cur: Snapshot, tol: number, selectors: Record<string, string>): Finding[] {
  const out: Finding[] = [];
  for (const [name, b] of Object.entries(base)) {
    const c = cur[name]; const selector = selectors[name] ?? b.selector;
    const auto = isAuto(name);
    if (!b.present) continue;
    // elementi automatici: la sparizione può derivare da un cambio di struttura (indici nth-of-type) → "review", non "critical"
    if (!c || !c.present) { out.push({ kind: 'missing', element: name, severity: auto ? 'review' : 'critical', message: 'Elemento presente nella baseline ma assente ora', selector }); continue; }
    if (b.visible && !c.visible) { out.push({ kind: 'hidden', element: name, severity: auto ? 'review' : 'critical', message: 'Elemento ora non visibile', selector }); continue; }
    const dPos = Math.max(Math.abs(c.x - b.x), Math.abs(c.y - b.y));
    const dSize = Math.max(Math.abs(c.w - b.w), Math.abs(c.h - b.h));
    if (dPos > tol) out.push({ kind: 'moved', element: name, severity: dPos > tol * 10 ? 'critical' : 'review', message: `Spostato di ${dPos}px (x ${b.x}→${c.x}, y ${b.y}→${c.y})`, selector });
    if (dSize > tol) out.push({ kind: 'resized', element: name, severity: dSize > tol * 10 ? 'critical' : 'review', message: `Dimensioni cambiate (${b.w}×${b.h} → ${c.w}×${c.h})`, selector });
    const styleDiffs = (Object.keys(b.style) as (keyof ElSnap['style'])[]).filter((k) => b.style[k] !== c.style[k]);
    if (styleDiffs.length) out.push({ kind: 'style', element: name, severity: 'info', message: `Stile cambiato: ${styleDiffs.map((k) => `${k} "${b.style[k]}" → "${c.style[k]}"`).join('; ')}`, selector });
    if (b.text !== c.text) out.push({ kind: 'text', element: name, severity: 'info', message: 'Testo cambiato', selector });
  }
  // sovrapposizioni nuove: solo tra elementi configurati a mano (gli automatici sono spesso annidati per costruzione)
  const names = Object.keys(cur).filter((n) => !isAuto(n));
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = cur[names[i]], b = cur[names[j]];
    if (!a.present || !b.present || !a.visible || !b.visible) continue;
    const now = inter(a, b);
    const was = base[names[i]] && base[names[j]] ? inter(base[names[i]], base[names[j]]) : 0;
    if (now > 100 && now > was * 1.5 + 100) out.push({ kind: 'overlap', element: `${names[i]} × ${names[j]}`, severity: 'review', message: `Nuova sovrapposizione (~${now}px²)` });
  }
  return collapseCascade(out);
}

/** Se un elemento sopra si allunga, tutto ciò che sta sotto "si sposta": con molti spostamenti automatici ne facciamo un solo finding. */
export function collapseCascade(findings: Finding[], threshold = 5): Finding[] {
  const movedAuto = findings.filter((f) => f.kind === 'moved' && isAuto(f.element));
  if (movedAuto.length <= threshold) return findings;
  const rest = findings.filter((f) => !movedAuto.includes(f));
  const worst = movedAuto.some((f) => f.severity === 'critical') ? 'critical' : 'review';
  rest.push({ kind: 'moved', element: `${movedAuto.length} elementi automatici`, severity: worst, message: `${movedAuto.length} elementi spostati (probabile effetto a cascata di una modifica sopra di loro)` });
  return rest;
}
