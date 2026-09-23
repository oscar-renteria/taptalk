// Renders the PWA PNG icons from public/icon.svg with Playwright's Chromium (already a dev
// dependency), so no image tooling is needed. Run: node apps/web/scripts/generate-icons.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const svg = readFileSync(`${publicDir}icon.svg`, 'utf8');
const glyph = svg.replace(/^[\s\S]*?<rect[^>]*\/>/, '').replace('</svg>', '');

// Maskable icons are cropped to a circle or squircle by the OS: full-bleed background, with the
// glyph scaled into the central 80% safe zone.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#23302c" />
  <g transform="translate(51.2 51.2) scale(0.8)">${glyph}</g>
</svg>`;

const outputs = [
  { file: 'icon-192.png', size: 192, source: svg },
  { file: 'icon-512.png', size: 512, source: svg },
  { file: 'icon-maskable-512.png', size: 512, source: maskable },
  { file: 'apple-touch-icon.png', size: 180, source: maskable },
];

const browser = await chromium.launch();
try {
  for (const { file, size, source } of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
    );
    await page.screenshot({ path: `${publicDir}${file}`, omitBackground: true });
    await page.close();
    console.log(`wrote public/${file}`);
  }
} finally {
  await browser.close();
}
