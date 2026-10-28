import type { Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const FREEZE_CSS = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}`;

/** Prepara la pagina in modo deterministico (animazioni off, font pronti, lazy-load attivato) e scatta lo screenshot full page. */
export async function captureFullPage(page: Page, outPath: string, maskSelectors: string[]): Promise<void> {
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  // scroll progressivo per attivare le immagini lazy, poi ritorno in cima
  await page.evaluate(async () => {
    const step = Math.max(400, window.innerHeight - 100);
    for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    window.scrollTo(0, 0);
  }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => { /* siti con polling: proseguiamo */ });
  await page.waitForTimeout(300);
  const masks = maskSelectors.map((s) => page.locator(s));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, fullPage: true, animations: 'disabled', caret: 'hide', mask: masks, maskColor: '#ff00ff' });
}
