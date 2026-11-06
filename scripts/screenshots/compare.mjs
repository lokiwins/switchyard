#!/usr/bin/env node
/*
 * Compares two captures scene by scene and writes report.json.
 *
 *   node compare.mjs --base <capture dir> --head <capture dir> --out report.json
 *
 * A missing or empty base (e.g. the first release) makes every scene "new".
 * Pixels are compared in the browser Playwright already ships, so there is no
 * image library to install.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { classify } from './report.mjs';

// Captures of the same code on the same runner are identical; this only absorbs stray anti-aliasing.
const CHANNEL_TOLERANCE = 8;
const MAX_DIFFERENT_PIXELS = 20;

const readManifest = (dir) => (dir && existsSync(join(dir, 'manifest.json'))
  ? JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  : {});

/** Whether two PNGs differ by more than a few pixels, decoded and compared on a canvas. */
async function pngsDiffer(page, a, b) {
  return page.evaluate(async ({ a, b, tolerance, maxDifferent }) => {
    const load = async (base64) => createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const [one, two] = await Promise.all([load(a), load(b)]);
    if (one.width !== two.width || one.height !== two.height) return true;
    const pixels = (bitmap) => {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const [p, q] = [pixels(one), pixels(two)];
    let different = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (Math.abs(p[i] - q[i]) > tolerance || Math.abs(p[i + 1] - q[i + 1]) > tolerance
        || Math.abs(p[i + 2] - q[i + 2]) > tolerance || Math.abs(p[i + 3] - q[i + 3]) > tolerance) {
        different += 1;
        if (different > maxDifferent) return true;
      }
    }
    return false;
  }, { a, b, tolerance: CHANNEL_TOLERANCE, maxDifferent: MAX_DIFFERENT_PIXELS });
}

async function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' }, head: { type: 'string' }, out: { type: 'string' } } });
  if (!values.head || !values.out) throw new Error('Usage: compare.mjs [--base <dir>] --head <dir> --out report.json');
  const base = readManifest(values.base);
  const head = readManifest(values.head);
  if (Object.keys(head).length === 0) throw new Error(`No manifest.json in ${values.head}`);

  const both = Object.keys(head).filter((name) => head[name].ok && base[name]?.ok);
  const differs = {};
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const name of both) {
      const png = (dir) => readFileSync(join(dir, `${name}.png`)).toString('base64');
      differs[name] = await pngsDiffer(page, png(values.base), png(values.head));
    }
  } finally {
    await browser.close();
  }
  const entries = classify(base, head, differs);
  writeFileSync(values.out, `${JSON.stringify({ entries }, null, 2)}\n`);
  entries.forEach((e) => console.log(`${e.name}: ${e.status}${e.error ? ` (${e.error})` : ''}`));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
