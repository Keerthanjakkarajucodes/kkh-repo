/**
 * LintCanvas – Visual diff engine
 * Uses pixelmatch to compute pixel-level differences between two PNG images.
 * Returns a structured diff result including detected diff regions.
 */

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { VisualDiffResult, DiffRegion } from "./types.js";
import { logger } from "./logger.js";

export interface DiffOptions {
  threshold?: number; // 0–1, default 0.1
  includeAntiAliasing?: boolean;
  outputPath?: string;
}

/**
 * Load a PNG image from disk and return as PNG object.
 * Throws with a clear message if file cannot be read or is not a valid PNG.
 */
function loadPng(filePath: string): PNG {
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch (e) {
    throw new Error(`Cannot read image at ${filePath}: ${(e as Error).message}`);
  }
  return PNG.sync.read(buf);
}

/**
 * Resize srcPng to match targetWidth × targetHeight by cropping or padding with white.
 * This normalises reference images that were captured at a different size.
 */
function normalizePng(src: PNG, targetWidth: number, targetHeight: number): PNG {
  if (src.width === targetWidth && src.height === targetHeight) return src;

  logger.warn(
    `Reference image (${src.width}×${src.height}) differs from rendered page ` +
      `(${targetWidth}×${targetHeight}). Normalising.`
  );

  const out = new PNG({ width: targetWidth, height: targetHeight });
  // Fill with white
  out.data.fill(255);

  const copyW = Math.min(src.width, targetWidth);
  const copyH = Math.min(src.height, targetHeight);

  for (let y = 0; y < copyH; y++) {
    for (let x = 0; x < copyW; x++) {
      const si = (y * src.width + x) * 4;
      const di = (y * targetWidth + x) * 4;
      out.data[di] = src.data[si]!;
      out.data[di + 1] = src.data[si + 1]!;
      out.data[di + 2] = src.data[si + 2]!;
      out.data[di + 3] = src.data[si + 3]!;
    }
  }
  return out;
}

/**
 * Group diff pixels into rectangular regions using a simple bounding-box flood fill.
 * We only group within the same 32×32 cell for performance.
 */
function detectDiffRegions(diffData: Uint8Array, width: number, height: number): DiffRegion[] {
  const CELL = 32;
  const totalPixels = width * height;
  const regionMap = new Map<string, { minX: number; minY: number; maxX: number; maxY: number; count: number }>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // pixelmatch writes diff pixels in red
      const r = diffData[idx]!;
      const a = diffData[idx + 3]!;
      if (a > 0 && r > 200) {
        const cx = Math.floor(x / CELL);
        const cy = Math.floor(y / CELL);
        const key = `${cx},${cy}`;
        const existing = regionMap.get(key);
        if (existing) {
          existing.minX = Math.min(existing.minX, x);
          existing.minY = Math.min(existing.minY, y);
          existing.maxX = Math.max(existing.maxX, x);
          existing.maxY = Math.max(existing.maxY, y);
          existing.count++;
        } else {
          regionMap.set(key, { minX: x, minY: y, maxX: x, maxY: y, count: 1 });
        }
      }
    }
  }

  const regions: DiffRegion[] = [];
  for (const r of regionMap.values()) {
    if (r.count < 4) continue; // skip noise
    regions.push({
      x: r.minX,
      y: r.minY,
      width: r.maxX - r.minX + 1,
      height: r.maxY - r.minY + 1,
      pixelCount: r.count,
      percentOfTotal: (r.count / totalPixels) * 100,
    });
  }

  // Sort by size descending
  return regions.sort((a, b) => b.pixelCount - a.pixelCount);
}

export async function compareScreenshots(
  referencePath: string,
  renderedPath: string,
  opts: DiffOptions = {}
): Promise<VisualDiffResult> {
  const threshold = opts.threshold ?? 0.1;

  const ref = loadPng(referencePath);
  const rendered = loadPng(renderedPath);

  // Normalise reference to rendered size for comparison
  const normRef = normalizePng(ref, rendered.width, rendered.height);

  const diff = new PNG({ width: rendered.width, height: rendered.height });

  const numMismatch = pixelmatch(
    normRef.data,
    rendered.data,
    diff.data,
    rendered.width,
    rendered.height,
    {
      threshold,
      includeAA: opts.includeAntiAliasing ?? false,
      alpha: 0.1,
    }
  );

  const totalPixels = rendered.width * rendered.height;
  const diffPercent = (numMismatch / totalPixels) * 100;
  const regions = detectDiffRegions(diff.data, rendered.width, rendered.height);

  let diffImagePath: string | undefined;
  if (opts.outputPath) {
    const pngBuf = PNG.sync.write(diff);
    writeFileSync(opts.outputPath, pngBuf);
    diffImagePath = opts.outputPath;
    logger.debug(`Diff image saved to ${opts.outputPath}`);
  }

  const result: VisualDiffResult = {
    totalPixels,
    diffPixels: numMismatch,
    diffPercent,
    diffRegions: regions,
    diffImagePath,
  };

  logger.debug(
    `Visual diff: ${numMismatch} differing pixels (${diffPercent.toFixed(2)}%), ${regions.length} regions`
  );

  return result;
}

export function formatDiffSummary(diff: VisualDiffResult): string {
  if (diff.diffPercent < 0.01) return "✔ Pixel-perfect match";
  const pct = diff.diffPercent.toFixed(2);
  const regions = diff.diffRegions.length;
  return `${pct}% pixel mismatch across ${regions} region${regions !== 1 ? "s" : ""}`;
}
