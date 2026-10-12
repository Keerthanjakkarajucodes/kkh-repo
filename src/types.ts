/**
 * LintCanvas – Types and schemas
 * All Zod schemas and shared TypeScript types live here.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const ConfigSchema = z.object({
  version: z.string().default("1"),
  projectRoot: z.string(),
  targetUrl: z.string().url().optional(),
  devCommand: z.string().optional(),
  devPort: z.number().int().positive().optional(),
  referenceDesktop: z.string().optional(),
  referenceMobile: z.string().optional(),
  viewport: z
    .object({
      desktop: z.object({ width: z.number(), height: z.number() }).default({ width: 1280, height: 800 }),
      mobile: z.object({ width: z.number(), height: z.number() }).default({ width: 375, height: 812 }),
    })
    .default({}),
  designRules: z.array(z.string()).default([]),
  gemmaModel: z.string().default("gemma-4-31b-it"),
  outputDir: z.string().default(".lintcanvas"),
  ci: z
    .object({
      failOnWarnings: z.boolean().default(false),
      maxMismatchPercent: z.number().min(0).max(100).default(5),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

// ---------------------------------------------------------------------------
// Visual diff
// ---------------------------------------------------------------------------

export const DiffRegionSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  pixelCount: z.number(),
  percentOfTotal: z.number(),
});

export type DiffRegion = z.infer<typeof DiffRegionSchema>;

export const VisualDiffResultSchema = z.object({
  totalPixels: z.number(),
  diffPixels: z.number(),
  diffPercent: z.number(),
  diffRegions: z.array(DiffRegionSchema),
  diffImagePath: z.string().optional(),
});

export type VisualDiffResult = z.infer<typeof VisualDiffResultSchema>;

// ---------------------------------------------------------------------------
// DOM inspection
// ---------------------------------------------------------------------------

export const ElementInfoSchema = z.object({
  selector: z.string(),
  tagName: z.string(),
  id: z.string().optional(),
  classes: z.array(z.string()),
  accessibleName: z.string().optional(),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    left: z.number(),
  }),
  computedStyles: z.record(z.string()),
  isVisible: z.boolean(),
  overflowsViewport: z.boolean(),
  zIndex: z.number().optional(),
  stackingContext: z.boolean().optional(),
});

export type ElementInfo = z.infer<typeof ElementInfoSchema>;

// ---------------------------------------------------------------------------
// AI findings
// ---------------------------------------------------------------------------

export const IssueCategorySchema = z.enum([
  "spacing",
  "alignment",
  "sizing",
  "text-clipping",
  "overflow",
  "visibility",
  "color",
  "typography",
  "layout",
  "unknown",
]);

export type IssueCategory = z.infer<typeof IssueCategorySchema>;

export const SeveritySchema = z.enum(["error", "warning", "info"]);

export type Severity = z.infer<typeof SeveritySchema>;

export const FindingSchema = z.object({
  id: z.string(),
  category: IssueCategorySchema,
  severity: SeveritySchema,
  selector: z.string(),
  description: z.string(),
  referenceValue: z.string().optional(),
  renderedValue: z.string().optional(),
  evidence: z.string(),
  likelyCause: z.string(),
  candidateProperty: z.string().optional(),
  candidateFile: z.string().optional(),
  candidateLine: z.number().optional(),
  proposedOldValue: z.string().optional(),
  proposedNewValue: z.string().optional(),
  confidence: z.enum(["high", "medium", "low"]),
  requiresHumanReview: z.boolean(),
  verificationHint: z.string().optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

// Validate AI model response – array of findings
export const AIFindingsResponseSchema = z.object({
  findings: z.array(FindingSchema),
  summary: z.string(),
  analysisNotes: z.string().optional(),
});

export type AIFindingsResponse = z.infer<typeof AIFindingsResponseSchema>;

// ---------------------------------------------------------------------------
// Patches
// ---------------------------------------------------------------------------

export const PatchSchema = z.object({
  findingId: z.string(),
  file: z.string(),
  property: z.string(),
  selector: z.string(),
  oldValue: z.string(),
  newValue: z.string(),
  diff: z.string(),
  backupPath: z.string().optional(),
  applied: z.boolean().default(false),
  verified: z.boolean().optional(),
  rolledBack: z.boolean().optional(),
});

export type Patch = z.infer<typeof PatchSchema>;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export const CheckReportSchema = z.object({
  timestamp: z.string(),
  config: ConfigSchema,
  screenshotBefore: z.string(),
  referenceScreenshot: z.string().optional(),
  diffResult: VisualDiffResultSchema.optional(),
  findings: z.array(FindingSchema),
  summary: z.string(),
  passedCI: z.boolean(),
  viewport: z.enum(["desktop", "mobile"]),
});

export type CheckReport = z.infer<typeof CheckReportSchema>;

export const VerifyReportSchema = z.object({
  timestamp: z.string(),
  screenshotAfter: z.string(),
  diffResultAfter: VisualDiffResultSchema.optional(),
  patchResults: z.array(
    z.object({
      patch: PatchSchema,
      improved: z.boolean(),
      newRegressions: z.array(z.string()),
      rolledBack: z.boolean(),
      reason: z.string().optional(),
    })
  ),
  overallImproved: z.boolean(),
  regressionDetected: z.boolean(),
});

export type VerifyReport = z.infer<typeof VerifyReportSchema>;

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

export const BenchmarkCaseSchema = z.object({
  id: z.string(),
  description: z.string(),
  cssFile: z.string(),
  brokenCssFile: z.string(),
  expectedFindingCategories: z.array(IssueCategorySchema),
  expectedSelector: z.string().optional(),
  expectedProperty: z.string().optional(),
  expectHumanReview: z.boolean().default(false),
  expectedRepairSuccess: z.boolean().default(true),
});

export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;

export const BenchmarkResultSchema = z.object({
  caseId: z.string(),
  detected: z.boolean(),
  correctSelector: z.boolean(),
  correctProperty: z.boolean(),
  repairAttempted: z.boolean(),
  repairSucceeded: z.boolean(),
  regression: z.boolean(),
  humanReviewRequested: z.boolean(),
  notes: z.string().optional(),
});

export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>;
