/**
 * Unit tests for CheckReport and VerifyReport generation and storage
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import path from "path";
import { CheckReportSchema, VerifyReportSchema, ConfigSchema } from "../src/types.js";
import { saveReport, loadLatestReport } from "../src/config.js";
import type { Config, CheckReport, VerifyReport } from "../src/types.js";

const TMP_DIR = path.join(process.cwd(), "test-tmp-report");

beforeAll(() => {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
});

const mockConfig: Config = ConfigSchema.parse({
  projectRoot: TMP_DIR,
  targetUrl: "http://localhost:5173",
  referenceDesktop: "reference/desktop.png",
  outputDir: ".lintcanvas",
  ci: {
    failOnWarnings: false,
    maxMismatchPercent: 5,
  },
});

describe("Report Generation & Schema Validation", () => {
  it("validates a matching screenshots report (0% diff)", () => {
    const report: CheckReport = {
      timestamp: new Date().toISOString(),
      config: mockConfig,
      screenshotBefore: ".lintcanvas/screenshots/before.png",
      referenceScreenshot: "reference/desktop.png",
      diffResult: {
        totalPixels: 1024000,
        diffPixels: 0,
        diffPercent: 0,
        diffRegions: [],
        diffImagePath: undefined,
      },
      findings: [],
      summary: "Pixel-perfect match. No visual regressions detected.",
      passedCI: true,
      viewport: "desktop",
    };

    const parsed = CheckReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.passedCI).toBe(true);
      expect(parsed.data.diffResult?.diffPercent).toBe(0);
    }
  });

  it("validates a differing screenshots report with regions and findings", () => {
    const report: CheckReport = {
      timestamp: new Date().toISOString(),
      config: mockConfig,
      screenshotBefore: ".lintcanvas/screenshots/before.png",
      referenceScreenshot: "reference/desktop.png",
      diffResult: {
        totalPixels: 1024000,
        diffPixels: 51200,
        diffPercent: 5.0,
        diffRegions: [
          {
            x: 100,
            y: 50,
            width: 200,
            height: 100,
            pixelCount: 20000,
            percentOfTotal: 1.95,
          },
          {
            x: 400,
            y: 300,
            width: 300,
            height: 150,
            pixelCount: 31200,
            percentOfTotal: 3.05,
          },
        ],
        diffImagePath: ".lintcanvas/screenshots/diff.png",
      },
      findings: [
        {
          id: "F001",
          category: "spacing",
          severity: "error",
          selector: ".nav",
          description: "Nav padding is 48px instead of 12px",
          evidence: "Nav height is larger than reference",
          likelyCause: "padding: 48px 24px in CSS",
          candidateProperty: "padding",
          candidateFile: "src/index.css",
          candidateLine: 26,
          proposedOldValue: "48px 24px",
          proposedNewValue: "12px 24px",
          confidence: "high",
          requiresHumanReview: false,
        },
      ],
      summary: "1 visual regression detected.",
      passedCI: false,
      viewport: "desktop",
    };

    const parsed = CheckReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.passedCI).toBe(false);
      expect(parsed.data.diffResult?.diffRegions.length).toBe(2);
      expect(parsed.data.findings.length).toBe(1);
    }
  });

  it("validates size mismatch report normalisation", () => {
    const report: CheckReport = {
      timestamp: new Date().toISOString(),
      config: mockConfig,
      screenshotBefore: ".lintcanvas/screenshots/before.png",
      referenceScreenshot: "reference/desktop-different-size.png",
      diffResult: {
        totalPixels: 1024000,
        diffPixels: 12000,
        diffPercent: 1.17,
        diffRegions: [],
        diffImagePath: ".lintcanvas/screenshots/diff.png",
      },
      findings: [],
      summary: "Reference normalised from 800x600 to 1280x800.",
      passedCI: true,
      viewport: "desktop",
    };

    const parsed = CheckReportSchema.safeParse(report);
    expect(parsed.success).toBe(true);
  });

  it("saves report to disk and updates latest.json", () => {
    const report: CheckReport = {
      timestamp: new Date().toISOString(),
      config: mockConfig,
      screenshotBefore: ".lintcanvas/screenshots/before.png",
      referenceScreenshot: "reference/desktop.png",
      diffResult: {
        totalPixels: 10000,
        diffPixels: 200,
        diffPercent: 2.0,
        diffRegions: [],
      },
      findings: [],
      summary: "Check completed successfully.",
      passedCI: true,
      viewport: "desktop",
    };

    const reportFile = saveReport(mockConfig, "test-check", report);
    expect(existsSync(reportFile)).toBe(true);

    const savedContent = JSON.parse(readFileSync(reportFile, "utf-8"));
    expect(savedContent.passedCI).toBe(true);
    expect(savedContent.summary).toBe("Check completed successfully.");

    const latest = loadLatestReport(mockConfig);
    expect(latest).not.toBeNull();
    expect(latest.summary).toBe("Check completed successfully.");
  });

  it("validates VerifyReportSchema", () => {
    const verifyReport: VerifyReport = {
      timestamp: new Date().toISOString(),
      screenshotAfter: ".lintcanvas/screenshots/after.png",
      diffResultAfter: {
        totalPixels: 1024000,
        diffPixels: 0,
        diffPercent: 0,
        diffRegions: [],
      },
      patchResults: [
        {
          patch: {
            findingId: "F001",
            file: "src/index.css",
            property: "padding",
            selector: ".nav",
            oldValue: "48px 24px",
            newValue: "12px 24px",
            diff: "- padding: 48px 24px\n+ padding: 12px 24px",
            applied: true,
            verified: true,
          },
          improved: true,
          newRegressions: [],
          rolledBack: false,
        },
      ],
      overallImproved: true,
      regressionDetected: false,
    };

    const parsed = VerifyReportSchema.safeParse(verifyReport);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.overallImproved).toBe(true);
      expect(parsed.data.patchResults[0]?.improved).toBe(true);
    }
  });
});
