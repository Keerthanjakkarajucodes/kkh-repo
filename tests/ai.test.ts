/**
 * Unit tests for the AI client schema validation and safety checks
 */

import { describe, it, expect } from "vitest";
import { isSafeProperty } from "../src/ai.js";
import { AIFindingsResponseSchema } from "../src/types.js";

describe("isSafeProperty", () => {
  it("allows safe CSS properties", () => {
    const safe = ["margin", "padding", "gap", "font-size", "width", "max-width", "display", "flex-direction"];
    for (const p of safe) {
      expect(isSafeProperty(p)).toBe(true);
    }
  });

  it("rejects unsafe or arbitrary properties", () => {
    const unsafe = ["background-image", "content", "animation", "transition", "filter", "arbitrary-custom"];
    for (const p of unsafe) {
      expect(isSafeProperty(p)).toBe(false);
    }
  });

  it("is case-insensitive", () => {
    expect(isSafeProperty("MARGIN")).toBe(true);
    expect(isSafeProperty("Padding-Top")).toBe(true);
  });

  it("trims whitespace", () => {
    expect(isSafeProperty("  gap  ")).toBe(true);
  });
});

describe("AIFindingsResponseSchema", () => {
  it("accepts a valid findings response", () => {
    const valid = {
      findings: [
        {
          id: "F001",
          category: "spacing",
          severity: "error",
          selector: ".hero",
          description: "Too much padding",
          evidence: "Reference shows 16px, rendered shows 32px",
          likelyCause: "Incorrect padding value in hero CSS rule",
          candidateProperty: "padding",
          proposedOldValue: "32px",
          proposedNewValue: "16px",
          confidence: "high",
          requiresHumanReview: false,
        },
      ],
      summary: "One spacing issue found.",
    };

    const result = AIFindingsResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects invalid severity", () => {
    const invalid = {
      findings: [
        {
          id: "F001",
          category: "spacing",
          severity: "critical", // invalid
          selector: ".hero",
          description: "Issue",
          evidence: "Evidence",
          likelyCause: "Cause",
          confidence: "high",
          requiresHumanReview: false,
        },
      ],
      summary: "Test",
    };

    const result = AIFindingsResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects invalid category", () => {
    const invalid = {
      findings: [
        {
          id: "F001",
          category: "not-a-real-category",
          severity: "warning",
          selector: ".hero",
          description: "Issue",
          evidence: "Evidence",
          likelyCause: "Cause",
          confidence: "medium",
          requiresHumanReview: false,
        },
      ],
      summary: "Test",
    };

    const result = AIFindingsResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const invalid = {
      findings: [
        {
          id: "F001",
          // missing category, severity, description, evidence, likelyCause, confidence, requiresHumanReview
          selector: ".hero",
        },
      ],
      summary: "Test",
    };

    const result = AIFindingsResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("accepts a response with no findings", () => {
    const result = AIFindingsResponseSchema.safeParse({
      findings: [],
      summary: "No issues found.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a human-review finding", () => {
    const valid = {
      findings: [
        {
          id: "F002",
          category: "layout",
          severity: "warning",
          selector: "nav",
          description: "Navigation layout differs",
          evidence: "Visual mismatch in header area",
          likelyCause: "Unknown – may be intentional",
          confidence: "low",
          requiresHumanReview: true,
        },
      ],
      summary: "One finding requires human review.",
    };

    const result = AIFindingsResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.findings[0]?.requiresHumanReview).toBe(true);
    }
  });
});
