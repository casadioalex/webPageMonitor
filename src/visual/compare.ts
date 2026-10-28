import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface DiffResult {
  diffPixels: number; ratio: number; baseSize: [number, number]; curSize: [number, number]; sizeChanged: boolean; heightDelta: number;
}

function crop(img: PNG, w: number, h: number): PNG {
  if (img.width === w && img.height === h) return img;
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(img, out, 0, 0, w, h, 0, 0);
  return out;
}

export function compareImages(basePath: string, curPath: string, diffPath: string, threshold: number): DiffResult {
  const a = PNG.sync.read(fs.readFileSync(basePath));
  const b = PNG.sync.read(fs.readFileSync(curPath));
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const ca = crop(a, w, h), cb = crop(b, w, h);
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(ca.data, cb.data, diff.data, w, h, { threshold, includeAA: false });
  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  return {
    diffPixels: n, ratio: n / (w * h),
    baseSize: [a.width, a.height], curSize: [b.width, b.height],
    sizeChanged: a.width !== b.width || a.height !== b.height, heightDelta: b.height - a.height,
  };
}
