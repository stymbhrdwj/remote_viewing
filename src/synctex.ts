import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export interface SyncRecord {
  page: number;
  tag: number;
  line: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SyncTeXData {
  inputs: Map<number, string>;
  records: SyncRecord[];
  pdfDir: string;
  mtime: number;
}

export interface SyncForwardResult {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SyncReverseResult {
  file: string;
  line: number;
  col: number;
  x: number;
  y: number;
}

const syncCache = new Map<string, SyncTeXData>();

/**
 * Parses SyncTeX data associated with a PDF file (.synctex.gz or .synctex).
 */
export function getSyncTeXData(pdfPath: string): SyncTeXData | null {
  const dir = path.dirname(pdfPath);
  const base = path.basename(pdfPath, path.extname(pdfPath));
  const synctexGz = path.join(dir, `${base}.synctex.gz`);
  const synctexPlain = path.join(dir, `${base}.synctex`);

  let targetFile: string | null = null;
  if (fs.existsSync(synctexGz)) {
    targetFile = synctexGz;
  } else if (fs.existsSync(synctexPlain)) {
    targetFile = synctexPlain;
  }

  if (!targetFile) {
    syncCache.delete(pdfPath);
    return null;
  }

  try {
    const stats = fs.statSync(targetFile);
    const cached = syncCache.get(pdfPath);
    if (cached && cached.mtime === stats.mtimeMs) {
      return cached;
    }

    let content: string;
    if (targetFile.endsWith('.gz')) {
      const buffer = fs.readFileSync(targetFile);
      content = zlib.gunzipSync(buffer).toString('utf8');
    } else {
      content = fs.readFileSync(targetFile, 'utf8');
    }

    const lines = content.split('\n');
    const inputs = new Map<number, string>();
    let unit = 1;
    let mag = 1000;
    let xOffset = 0;
    let yOffset = 0;
    let currentPage: number | null = null;
    const records: SyncRecord[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('Input:')) {
        const parts = line.slice(6).split(':');
        const tag = parseInt(parts[0], 10);
        let inputPath = parts.slice(1).join(':');
        if (!path.isAbsolute(inputPath)) {
          inputPath = path.resolve(dir, inputPath);
        }
        inputs.set(tag, inputPath);
      } else if (line.startsWith('Unit:')) {
        unit = parseFloat(line.slice(5)) || 1;
      } else if (line.startsWith('Magnification:')) {
        mag = parseFloat(line.slice(14)) || 1000;
      } else if (line.startsWith('X Offset:')) {
        xOffset = parseFloat(line.slice(9)) || 0;
      } else if (line.startsWith('Y Offset:')) {
        yOffset = parseFloat(line.slice(9)) || 0;
      } else if (line.startsWith('{')) {
        currentPage = parseInt(line.slice(1), 10);
      } else if (line.startsWith('}')) {
        currentPage = null;
      } else if (currentPage !== null) {
        const type = line[0];
        if ('xkg[($h'.includes(type)) {
          const rest = line.slice(1);
          const colonIdx = rest.indexOf(':');
          if (colonIdx !== -1) {
            const tagLine = rest.slice(0, colonIdx).split(',');
            const tag = parseInt(tagLine[0], 10);
            const lineNum = parseInt(tagLine[1], 10);

            const coords = rest.slice(colonIdx + 1).split(':');
            const xy = coords[0].split(',');
            const rawX = parseInt(xy[0], 10);
            const rawY = parseInt(xy[1], 10);

            let rawW = 0;
            let rawH = 0;
            if (coords.length > 1) {
              const whd = coords[1].split(',');
              rawW = parseInt(whd[0], 10) || 0;
              rawH = parseInt(whd[1], 10) || 0;
            }

            // SyncTeX coordinates conversion to PDF points
            const factor = (unit / 65536) * (mag / 1000);
            const ptX = rawX * factor + xOffset / 65536;
            const ptY = rawY * factor + yOffset / 65536;
            const ptW = rawW * factor;
            const ptH = rawH * factor;

            records.push({
              page: currentPage,
              tag,
              line: lineNum,
              x: ptX,
              y: ptY,
              width: ptW,
              height: ptH
            });
          }
        }
      }
    }

    const data: SyncTeXData = {
      inputs,
      records,
      pdfDir: dir,
      mtime: stats.mtimeMs
    };
    syncCache.set(pdfPath, data);
    return data;
  } catch (err) {
    console.warn(`[SyncTeX] Failed to parse synctex for ${pdfPath}:`, err);
    return null;
  }
}

/**
 * Forward search: Find PDF position from TeX source file and line.
 */
export function forwardSearch(pdfPath: string, sourcePath: string, line: number): SyncForwardResult | null {
  const sync = getSyncTeXData(pdfPath);
  if (!sync) return null;

  let targetTag: number | null = null;
  const normTarget = path.normalize(sourcePath);
  const baseTarget = path.basename(sourcePath);

  for (const [tag, p] of sync.inputs.entries()) {
    if (path.normalize(p) === normTarget || path.basename(p) === baseTarget) {
      targetTag = tag;
      break;
    }
  }

  if (targetTag === null) return null;

  const matches = sync.records.filter((r) => r.tag === targetTag);
  if (matches.length === 0) return null;

  // Find exact line or closest line
  let best: SyncRecord | null = null;
  let minDiff = Infinity;

  for (const r of matches) {
    const diff = Math.abs(r.line - line);
    if (diff < minDiff) {
      minDiff = diff;
      best = r;
    }
  }

  if (!best) return null;

  return {
    page: best.page,
    x: best.x,
    y: best.y,
    width: Math.max(best.width, 20),
    height: Math.max(best.height, 12)
  };
}

/**
 * Reverse search: Find TeX source file and line from PDF page and (x, y) coordinates.
 */
export function reverseSearch(pdfPath: string, page: number, x: number, y: number): SyncReverseResult | null {
  const sync = getSyncTeXData(pdfPath);
  if (!sync) return null;

  const pageRecords = sync.records.filter((r) => r.page === page);
  if (pageRecords.length === 0) return null;

  let best: SyncRecord | null = null;
  let minDistance = Infinity;

  for (const r of pageRecords) {
    const dx = r.x - x;
    const dy = r.y - y;
    const dist = dx * dx + dy * dy;
    if (dist < minDistance) {
      minDistance = dist;
      best = r;
    }
  }

  if (!best) return null;

  const rawFile = sync.inputs.get(best.tag);
  if (!rawFile) return null;

  let resolvedFile: string = rawFile;
  // If the file path does not exist as-is, try looking in pdfDir
  if (!fs.existsSync(resolvedFile)) {
    const altPath = path.join(sync.pdfDir, path.basename(resolvedFile));
    if (fs.existsSync(altPath)) {
      resolvedFile = altPath;
    }
  }

  return {
    file: resolvedFile,
    line: best.line,
    col: 0,
    x: best.x,
    y: best.y
  };
}
