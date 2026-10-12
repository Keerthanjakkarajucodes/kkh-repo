/**
 * Unit tests for the visual diff engine
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PNG } from "pngjs";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import path from "path";
import { compareScreenshots, formatDiffSummary } from "../src/diff.js";

const TMP_DIR = path.join(process.cwd(), "test-tmp-diff");

function makePng(width: number, height: number, r: number, g: number, b: number): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

function makeGradientPng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = Math.floor((x / width) * 255);
      png.data[idx + 1] = Math.floor((y / height) * 255);
      png.data[idx + 2] = 100;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

beforeAll(() => {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("compareScreenshots", () => {
  it("returns 0 diff for identical images", async () => {
    const buf = makePng(100, 100, 128, 200, 50);
    const p1 = path.join(TMP_DIR, "identical1.png");
    const p2 = path.join(TMP_DIR, "identical2.png");
    writeFileSync(p1, buf);
    writeFileSync(p2, buf);

    const result = await compareScreenshots(p1, p2);
    expect(result.diffPixels).toBe(0);
    expect(result.diffPercent).toBe(0);
    expect(result.totalPixels).toBe(10000);
  });

  it("detects differences between different-coloured images", async () => {
    const refBuf = makePng(100, 100, 255, 0, 0); // red
    const rendBuf = makePng(100, 100, 0, 0, 255); // blue
    const p1 = path.join(TMP_DIR, "red.png");
    const p2 = path.join(TMP_DIR, "blue.png");
    writeFileSync(p1, refBuf);
    writeFileSync(p2, rendBuf);

    const result = await compareScreenshots(p1, p2, { threshold: 0.1 });
    expect(result.diffPixels).toBeGreaterThan(0);
    expect(result.diffPercent).toBeGreaterThan(50);
  });

  it("handles size mismatch by normalising reference", async () => {
    const refBuf = makePng(80, 80, 200, 200, 200);
    const rendBuf = makePng(100, 100, 200, 200, 200);
    const p1 = path.join(TMP_DIR, "small.png");
    const p2 = path.join(TMP_DIR, "large.png");
    writeFileSync(p1, refBuf);
    writeFileSync(p2, rendBuf);

    // Should not throw
    const result = await compareScreenshots(p1, p2);
    expect(result.totalPixels).toBe(10000);
  });

  it("saves diff image when outputPath is provided", async () => {
    const buf1 = makePng(50, 50, 100, 100, 100);
    const buf2 = makePng(50, 50, 200, 200, 200);
    const p1 = path.join(TMP_DIR, "src1.png");
    const p2 = path.join(TMP_DIR, "src2.png");
    const diffOut = path.join(TMP_DIR, "diff-out.png");
    writeFileSync(p1, buf1);
    writeFileSync(p2, buf2);

    const result = await compareScreenshots(p1, p2, { outputPath: diffOut });
    expect(existsSync(diffOut)).toBe(true);
    expect(result.diffImagePath).toBe(diffOut);
  });

  it("identifies diff regions", async () => {
    // One half red, one half blue
    const ref = new PNG({ width: 100, height: 100 });
    const rend = new PNG({ width: 100, height: 100 });
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        const idx = (y * 100 + x) * 4;
        ref.data[idx] = 255; ref.data[idx+1] = 255; ref.data[idx+2] = 255; ref.data[idx+3] = 255;
        // Bottom half is different
        if (y >= 50) {
          rend.data[idx] = 0; rend.data[idx+1] = 0; rend.data[idx+2] = 0; rend.data[idx+3] = 255;
        } else {
          rend.data[idx] = 255; rend.data[idx+1] = 255; rend.data[idx+2] = 255; rend.data[idx+3] = 255;
        }
      }
    }
    const p1 = path.join(TMP_DIR, "half1.png");
    const p2 = path.join(TMP_DIR, "half2.png");
    writeFileSync(p1, PNG.sync.write(ref));
    writeFileSync(p2, PNG.sync.write(rend));

    const result = await compareScreenshots(p1, p2, { threshold: 0.1 });
    expect(result.diffPixels).toBeGreaterThan(0);
    expect(result.diffRegions.length).toBeGreaterThan(0);
  });

  it("throws a clear error for missing files", async () => {
    await expect(
      compareScreenshots("/nonexistent/ref.png", "/nonexistent/rend.png")
    ).rejects.toThrow(/Cannot read image/);
  });
});

describe("formatDiffSummary", () => {
  it("returns pixel-perfect for zero diff", () => {
    const msg = formatDiffSummary({ totalPixels: 1000, diffPixels: 0, diffPercent: 0, diffRegions: [] });
    expect(msg).toContain("Pixel-perfect");
  });

  it("includes percentage in summary", () => {
    const msg = formatDiffSummary({
      totalPixels: 1000,
      diffPixels: 50,
      diffPercent: 5.0,
      diffRegions: [{ x: 0, y: 0, width: 10, height: 5, pixelCount: 50, percentOfTotal: 5 }],
    });
    expect(msg).toContain("5.00%");
  });
});
