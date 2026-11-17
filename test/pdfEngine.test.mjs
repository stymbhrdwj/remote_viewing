import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Import compiled dist/extension or modules directly
import { PDFEngine } from '../dist/pdfEngine.js';
import { LRUCache } from '../dist/cache.js';
import { forwardSearch, reverseSearch, getSyncTeXData } from '../dist/synctex.js';
import { encodeToWebp, toDataUrl } from '../dist/webpEncoder.js';

const SAMPLE_PDF = '/home/nothing/Documents/Code-Config/Coding/Rule30/formulas.pdf';
const SAMPLE_TEX = '/home/nothing/Documents/Code-Config/Coding/Rule30/formulas.tex';

test('LRUCache operations', () => {
  const cache = new LRUCache(3);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.get('a'), 1);

  // Adding 'd' should evict 'b' (oldest access)
  cache.set('d', 4);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('c'), true);
  assert.equal(cache.has('d'), true);

  // Invalidate matching
  cache.invalidateWhere((k) => k === 'a' || k === 'd');
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('d'), false);
  assert.equal(cache.has('c'), true);
});

test('WebP Encoder encoding raw RGBA to WebP data URL', async () => {
  // Create a 64x64 RGBA test image (checkerboard)
  const width = 64;
  const height = 64;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const isWhite = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      pixels[idx] = isWhite ? 255 : 0;
      pixels[idx + 1] = isWhite ? 255 : 128;
      pixels[idx + 2] = isWhite ? 255 : 200;
      pixels[idx + 3] = 255;
    }
  }

  const webpBuffer = await encodeToWebp({ data: pixels, width, height }, 80);
  assert.ok(webpBuffer.length > 0);
  const dataUrl = toDataUrl(webpBuffer);
  assert.ok(dataUrl.startsWith('data:image/webp;base64,'));
  assert.ok(dataUrl.length > 50);
});

test('PDFEngine: getMetadata', async () => {
  const meta = await PDFEngine.getMetadata(SAMPLE_PDF);
  assert.equal(meta.pageCount, 1);
  assert.ok(meta.dimensions.length === 1);
  assert.ok(meta.dimensions[0].width > 500);
  assert.ok(meta.dimensions[0].height > 800);
});

test('PDFEngine: renderPage (server-side WebP streaming)', async () => {
  const t0 = Date.now();
  const render = await PDFEngine.renderPage(SAMPLE_PDF, 0, 1.5, 80);
  const elapsed = Date.now() - t0;

  assert.equal(render.pageIndex, 0);
  assert.equal(render.scale, 1.5);
  assert.ok(render.width > 800);
  assert.ok(render.height > 1200);
  assert.ok(render.dataUrl.startsWith('data:image/webp;base64,'));
  assert.ok(elapsed < 2000, `Rendering took ${elapsed}ms, should be fast`);

  // Second render should be cached (under 10ms)
  const t1 = Date.now();
  const cachedRender = await PDFEngine.renderPage(SAMPLE_PDF, 0, 1.5, 80);
  const cachedElapsed = Date.now() - t1;
  assert.equal(cachedRender.dataUrl, render.dataUrl);
  assert.ok(cachedElapsed < 50, `Cached render took ${cachedElapsed}ms`);
});

test('PDFEngine: renderTile (Seamless 1600% Zoom)', async () => {
  // Render a viewport tile at 16x zoom (1600%)
  const scale = 16.0;
  const tile = {
    x: 200,
    y: 130,
    width: 60,  // 60 pt * 16 = 960 px
    height: 40  // 40 pt * 16 = 640 px
  };

  const t0 = Date.now();
  const tileResult = await PDFEngine.renderTile(SAMPLE_PDF, 0, scale, tile, 80);
  const elapsed = Date.now() - t0;

  assert.equal(tileResult.pageIndex, 0);
  assert.equal(tileResult.scale, 16.0);
  assert.equal(tileResult.width, 960);
  assert.equal(tileResult.height, 640);
  assert.ok(tileResult.dataUrl.startsWith('data:image/webp;base64,'));
  assert.ok(elapsed < 1500, `1600% tile render took ${elapsed}ms`);
});

test('PDFEngine: extractText with bounding boxes', async () => {
  const spans = await PDFEngine.extractText(SAMPLE_PDF, 0);
  assert.ok(spans.length > 0);
  const fullText = spans.map((s) => s.text).join(' ');
  assert.ok(fullText.includes('log') || fullText.includes('S(2k'));
  // Verify bounding box values
  for (const s of spans) {
    assert.ok(s.bbox.length === 4);
    assert.ok(s.bbox[2] >= s.bbox[0]);
    assert.ok(s.bbox[3] >= s.bbox[1]);
  }
});

test('PDFEngine: search document', async () => {
  const results = await PDFEngine.search(SAMPLE_PDF, 'log');
  assert.ok(results.length > 0);
  assert.equal(results[0].pageIndex, 0);
  assert.ok(results[0].rects.length > 0);

  const rect = results[0].rects[0];
  assert.ok(rect[0] > 0 && rect[2] > rect[0]);
  assert.ok(rect[1] > 0 && rect[3] > rect[1]);

  // Non-existent search
  const empty = await PDFEngine.search(SAMPLE_PDF, 'xyznonexistent123');
  assert.equal(empty.length, 0);
});

test('SyncTeX: parseSyncTeX, forwardSearch, and reverseSearch', () => {
  const sync = getSyncTeXData(SAMPLE_PDF);
  assert.ok(sync !== null);
  assert.ok(sync.records.length > 0);

  // Forward search from line 5 of formulas.tex (equation 1)
  const forward = forwardSearch(SAMPLE_PDF, SAMPLE_TEX, 5);
  assert.ok(forward !== null);
  assert.equal(forward.page, 1);
  assert.ok(forward.y > 100 && forward.y < 200);

  // Reverse search clicking near equation 1 (220, 150)
  const reverse = reverseSearch(SAMPLE_PDF, 1, 220, 150);
  assert.ok(reverse !== null);
  assert.ok(reverse.file.endsWith('formulas.tex'));
  assert.ok(reverse.line === 4 || reverse.line === 6);
});
