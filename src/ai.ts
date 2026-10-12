/**
 * LintCanvas – Gemma 4 / Gemini AI client
 * Wraps the Google GenAI SDK for multimodal analysis with strict schema validation.
 */

import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { readFileSync } from "fs";
import { logger } from "./logger.js";
import type { Config, ElementInfo, VisualDiffResult, AIFindingsResponse, Finding } from "./types.js";
import { AIFindingsResponseSchema, FindingSchema } from "./types.js";

const SAFE_PROPERTIES = new Set([
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "row-gap",
  "column-gap",
  "width",
  "max-width",
  "min-width",
  "height",
  "max-height",
  "min-height",
  "font-size",
  "line-height",
  "letter-spacing",
  "text-align",
  "flex-direction",
  "align-items",
  "justify-content",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "grid-template-columns",
  "grid-template-rows",
  "overflow",
  "overflow-x",
  "overflow-y",
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "border-radius",
  "opacity",
  "visibility",
  "object-fit",
]);

export function isSafeProperty(prop: string): boolean {
  return SAFE_PROPERTIES.has(prop.toLowerCase().trim());
}

function loadImageAsBase64(filePath: string): string {
  const buf = readFileSync(filePath);
  return buf.toString("base64");
}

function buildAnalysisPrompt(
  diffResult: VisualDiffResult | undefined,
  elements: ElementInfo[],
  overflowWarnings: string[],
  designRules: string[],
  viewport: "desktop" | "mobile"
): string {
  const elementSummary = elements
    .filter((e) => e.isVisible)
    .slice(0, 25)
    .map((e) => {
      const rect = e.rect;
      const styles = Object.entries(e.computedStyles)
        .filter(([, v]) => v && v !== "0px" && v !== "none" && v !== "normal" && v !== "auto")
        .map(([k, v]) => `${k}: ${v}`)
        .slice(0, 8)
        .join("; ");
      return `  ${e.selector} (${rect.width}×${rect.height} at ${rect.x},${rect.y})${styles ? " — " + styles : ""}${e.overflowsViewport ? " [OVERFLOWS]" : ""}`;
    })
    .join("\n");

  const diffSummary = diffResult
    ? `Visual diff: ${diffResult.diffPercent.toFixed(2)}% pixel mismatch, ${diffResult.diffRegions.length} regions.\n` +
      diffResult.diffRegions
        .slice(0, 8)
        .map(
          (r) =>
            `  Region at (${r.x},${r.y}) size ${r.width}×${r.height}, ${r.pixelCount} different pixels`
        )
        .join("\n")
    : "No pixel-level diff data available (no reference image provided).";

  const overflowSection =
    overflowWarnings.length > 0
      ? `\nHORIZONTAL OVERFLOW DETECTED:\n${overflowWarnings.map((o) => `  ${o}`).join("\n")}`
      : "";

  const rulesSection =
    designRules.length > 0
      ? `\nDESIGN RULES PROVIDED BY DEVELOPER:\n${designRules.map((r) => `  - ${r}`).join("\n")}`
      : "";

  return `You are a UI regression analysis expert. You are given:
1. A reference design image (PNG exported from Figma or similar).
2. A screenshot of the actual rendered web page.
3. Pixel-level diff data and DOM measurements.

Viewport: ${viewport}

${diffSummary}${overflowSection}${rulesSection}

DOM ELEMENTS (visible elements with bounding boxes and key computed styles):
${elementSummary}

TASK:
Analyse the visual differences between the reference design (image 1) and the rendered page (image 2).
Focus on the 3 to 6 primary visual discrepancies causing the regression.
Keep descriptions and evidence concise. Focus directly on the root-cause CSS properties.

IMPORTANT RULES:
- Only report findings supported by visual evidence from the images or measurement data above.
- Do NOT invent design requirements. A nav bar on mobile is not a bug unless the mobile reference shows it differently.
- Distinguish: "error" (clear breakage), "warning" (likely issue), "info" (recommendation).
- If a fix cannot be mapped to a specific CSS property and source location with reasonable confidence, set requiresHumanReview = true.
- candidateProperty must be one of the safe CSS properties: ${Array.from(SAFE_PROPERTIES).join(", ")}.
- candidateFile should be a relative path to a CSS/SCSS/module file if identifiable, otherwise omit it.
- selector must be a valid CSS selector string.
- confidence: "high" means you are very certain; "low" means you are guessing.
- Do not propose JS rewrites, Tailwind class changes, or HTML restructuring.

RESPOND WITH VALID JSON ONLY – no markdown, no explanation outside the JSON:
{
  "findings": [
    {
      "id": "F001",
      "category": "spacing|alignment|sizing|text-clipping|overflow|visibility|color|typography|layout|unknown",
      "severity": "error|warning|info",
      "selector": "CSS selector string",
      "description": "Short description of the issue",
      "referenceValue": "value from design if measurable",
      "renderedValue": "value from DOM measurements",
      "evidence": "What you observed in the images or measurements",
      "likelyCause": "Probable CSS root cause",
      "candidateProperty": "css-property-name or omit",
      "candidateFile": "relative/path/to/file.css or omit",
      "candidateLine": 42,
      "proposedOldValue": "current value or omit",
      "proposedNewValue": "fixed value or omit",
      "confidence": "high|medium|low",
      "requiresHumanReview": false,
      "verificationHint": "What to check after applying the fix"
    }
  ],
  "summary": "One paragraph summary of all findings",
  "analysisNotes": "Optional: caveats or limitations of this analysis"
}`;
}

export class GemmaClient {
  private client: GoogleGenAI;
  private model: string;
  private fallbackModel: string;
  private activeModel: string;
  private timeout: number;

  constructor(
    apiKey: string,
    model: string,
    fallbackModel = "gemma-4-26b-a4b-it",
    timeout = 60_000,
    baseUrl?: string
  ) {
    const options: { apiKey: string; httpOptions?: { baseUrl?: string } } = { apiKey };
    if (baseUrl) {
      options.httpOptions = { baseUrl };
    }
    this.client = new GoogleGenAI(options);
    this.model = model;
    this.fallbackModel = fallbackModel;
    this.activeModel = model;
    this.timeout = timeout;
  }

  getModelName(): string {
    return this.activeModel;
  }

  private async requestModel(
    modelName: string,
    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>
  ): Promise<GenerateContentResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      return await this.client.models.generateContent({
        model: modelName,
        contents: [{ role: "user", parts }],
        config: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async analyzeUI(
    cfg: Config,
    referencePath: string | undefined,
    renderedPath: string,
    diffResult: VisualDiffResult | undefined,
    elements: ElementInfo[],
    overflowWarnings: string[],
    viewport: "desktop" | "mobile"
  ): Promise<AIFindingsResponse> {
    const systemPrompt = buildAnalysisPrompt(
      diffResult,
      elements,
      overflowWarnings,
      cfg.designRules,
      viewport
    );

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

    // Add reference image if available
    if (referencePath) {
      try {
        parts.push({
          inlineData: {
            mimeType: "image/png",
            data: loadImageAsBase64(referencePath),
          },
        });
        parts.push({ text: "Image 1: Reference design" });
      } catch (e) {
        logger.warn(`Could not load reference image: ${(e as Error).message}`);
      }
    }

    // Add rendered screenshot
    try {
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: loadImageAsBase64(renderedPath),
        },
      });
      parts.push({ text: referencePath ? "Image 2: Actual rendered page" : "Image: Actual rendered page" });
    } catch (e) {
      throw new Error(`Cannot load rendered screenshot: ${(e as Error).message}`);
    }

    parts.push({ text: systemPrompt });

    logger.debug(`Sending analysis request to ${this.model}...`);
    this.activeModel = this.model;

    let response: GenerateContentResponse;
    try {
      try {
        response = await this.requestModel(this.model, parts);
      } catch (primaryErr: unknown) {
        const err = primaryErr as Error & { status?: number };
        const isServerOrModelError =
          err.status === 500 ||
          (err.message && (err.message.includes("500") || err.message.includes("INTERNAL")));

        if (isServerOrModelError && this.fallbackModel && this.fallbackModel !== this.model) {
          logger.warn(
            `Model "${this.model}" returned an internal server error (HTTP 500). Retrying with Gemma 4 fallback model "${this.fallbackModel}"...`
          );
          this.activeModel = this.fallbackModel;
          response = await this.requestModel(this.fallbackModel, parts);
        } else {
          throw primaryErr;
        }
      }
    } catch (e: unknown) {
      const err = e as Error & { status?: number; message?: string };
      const msg = (err.message || "").toLowerCase();
      const status = err.status;

      if (
        msg.includes("api_key") ||
        msg.includes("api key") ||
        msg.includes("unauthenticated") ||
        msg.includes("permission_denied") ||
        status === 401 ||
        status === 403
      ) {
        throw new Error(
          "Invalid or missing Gemini API key.\n" +
            "Set GEMINI_API_KEY in your local .env file or environment.\n" +
            "Get a key at: https://aistudio.google.com/"
        );
      }
      if (msg.includes("404") || msg.includes("not found") || msg.includes("not_found")) {
        throw new Error(
          `Model "${this.activeModel}" not found or not accessible with your API key.\n` +
            "Verify GEMMA_MODEL in your .env file (e.g. gemma-4-31b-it or gemma-4-26b-a4b-it).\n" +
            "Documentation: https://ai.google.dev/gemma/docs"
        );
      }
      if (
        msg.includes("429") ||
        msg.includes("quota") ||
        msg.includes("resource_exhausted") ||
        status === 429
      ) {
        throw new Error(
          "Gemini API quota exceeded (HTTP 429 / RESOURCE_EXHAUSTED).\n" +
            "Wait a moment and try again, or check your rate limits in Google AI Studio."
        );
      }
      if (err.name === "AbortError" || msg.includes("abort") || msg.includes("timeout")) {
        throw new Error(`AI request timed out after ${this.timeout / 1000}s. Increase GEMINI_TIMEOUT in .env.`);
      }
      throw new Error(`AI API request failed: ${err.message}`);
    }

    const candidateParts = response.candidates?.[0]?.content?.parts ?? [];
    const nonThoughtPart = candidateParts.find((p) => !(p as { thought?: boolean }).thought && p.text);
    const rawText = nonThoughtPart?.text ?? candidateParts[candidateParts.length - 1]?.text ?? "";
    logger.debug(`AI response received (${rawText.length} chars)`);

    return this.parseAndValidate(rawText);
  }

  private parseAndValidate(rawText: string): AIFindingsResponse {
    let clean = rawText.trim();
    // 1. Check for markdown code fences (```json ... ``` or ``` ... ```)
    const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      clean = codeBlockMatch[1].trim();
    } else if (clean.startsWith("```")) {
      clean = clean.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // 2. Try to extract outermost JSON object { ... }
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          return this.salvageFromTruncatedText(clean, rawText);
        }
      } else {
        return this.salvageFromTruncatedText(clean, rawText);
      }
    }

    const result = AIFindingsResponseSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      logger.warn(`AI response failed schema validation:\n${issues}`);
      // Try to salvage what we can
      const salvaged = this.salvageFindings(parsed);
      if (salvaged.findings.length > 0) {
        return salvaged;
      }
      throw new Error(`AI response failed validation and could not be salvaged:\n${issues}`);
    }

    // Post-validate individual findings
    const validated = result.data;
    validated.findings = validated.findings.filter((f) => {
      if (f.candidateProperty && !isSafeProperty(f.candidateProperty)) {
        logger.warn(`Dropping finding ${f.id}: unsupported property "${f.candidateProperty}"`);
        return false;
      }
      return true;
    });

    return validated;
  }

  private salvageFindings(raw: unknown): AIFindingsResponse {
    const obj = raw as Record<string, unknown>;
    const rawFindings = Array.isArray(obj["findings"]) ? (obj["findings"] as unknown[]) : [];
    const findings: Finding[] = [];
    let idx = 0;
    for (const f of rawFindings) {
      const item = f as Record<string, unknown>;
      try {
        findings.push({
          id: String(item["id"] ?? `F${++idx}`),
          category: (item["category"] as Finding["category"]) ?? "unknown",
          severity: (item["severity"] as Finding["severity"]) ?? "warning",
          selector: String(item["selector"] ?? "body"),
          description: String(item["description"] ?? "Unknown issue"),
          evidence: String(item["evidence"] ?? ""),
          likelyCause: String(item["likelyCause"] ?? ""),
          candidateProperty: typeof item["candidateProperty"] === "string" ? item["candidateProperty"] : undefined,
          candidateFile: typeof item["candidateFile"] === "string" ? item["candidateFile"] : undefined,
          candidateLine: typeof item["candidateLine"] === "number" ? item["candidateLine"] : undefined,
          proposedOldValue: typeof item["proposedOldValue"] === "string" ? item["proposedOldValue"] : undefined,
          proposedNewValue: typeof item["proposedNewValue"] === "string" ? item["proposedNewValue"] : undefined,
          confidence: (item["confidence"] as Finding["confidence"]) ?? "low",
          requiresHumanReview: Boolean(item["requiresHumanReview"] ?? true),
        });
      } catch {
        // skip malformed finding
      }
    }
    return {
      findings,
      summary: String(obj["summary"] ?? "Analysis completed with validation errors."),
    };
  }

  private salvageFromTruncatedText(text: string, rawText: string): AIFindingsResponse {
    const findings: Finding[] = [];
    const findingObjRegex = /\{\s*"id"\s*:\s*"([^"]+)"[\s\S]*?\n\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = findingObjRegex.exec(text)) !== null) {
      try {
        const item = JSON.parse(m[0]);
        const res = FindingSchema.safeParse(item);
        if (res.success) {
          findings.push(res.data);
        } else if (item.id && item.description) {
          findings.push({
            id: String(item.id),
            category: (item.category as Finding["category"]) ?? "unknown",
            severity: (item.severity as Finding["severity"]) ?? "warning",
            selector: String(item.selector ?? "body"),
            description: String(item.description),
            evidence: String(item.evidence ?? ""),
            likelyCause: String(item.likelyCause ?? ""),
            candidateProperty: typeof item.candidateProperty === "string" ? item.candidateProperty : undefined,
            candidateFile: typeof item.candidateFile === "string" ? item.candidateFile : undefined,
            candidateLine: typeof item.candidateLine === "number" ? item.candidateLine : undefined,
            proposedOldValue: typeof item.proposedOldValue === "string" ? item.proposedOldValue : undefined,
            proposedNewValue: typeof item.proposedNewValue === "string" ? item.proposedNewValue : undefined,
            confidence: (item.confidence as Finding["confidence"]) ?? "medium",
            requiresHumanReview: Boolean(item.requiresHumanReview),
            verificationHint: typeof item.verificationHint === "string" ? item.verificationHint : undefined,
          });
        }
      } catch {
        // continue searching
      }
    }

    if (findings.length > 0) {
      logger.info(`Salvaged ${findings.length} complete finding(s) from response.`);
      return {
        findings,
        summary: "Analysis completed (recovered from partial or truncated response).",
      };
    }

    throw new Error(
      `AI returned malformed or truncated JSON and no findings could be salvaged. Raw response:\n${rawText.slice(0, 500)}`
    );
  }

  async listAvailableModels(): Promise<string[]> {
    try {
      const result = await this.client.models.list();
      const models: string[] = [];
      for await (const m of result) {
        if (m.name) models.push(m.name);
      }
      return models;
    } catch {
      return [];
    }
  }
}

export function createGemmaClient(cfg: Config): GemmaClient | null {
  let apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    logger.warn(
      "GEMINI_API_KEY not set. AI diagnosis will be skipped.\n" +
        "Set GEMINI_API_KEY in your local .env file to enable AI-powered analysis."
    );
    return null;
  }
  apiKey = apiKey.trim().replace(/^["']|["']$/g, "").replace(/"/g, "");
  const model = process.env["GEMMA_MODEL"] ?? cfg.gemmaModel ?? "gemma-4-31b-it";
  const fallbackModel = process.env["GEMMA_FALLBACK_MODEL"] ?? "gemma-4-26b-a4b-it";
  const timeout = parseInt(process.env["GEMINI_TIMEOUT"] ?? "60000", 10);
  const baseUrl = process.env["GEMINI_BASE_URL"];
  return new GemmaClient(apiKey, model, fallbackModel, timeout, baseUrl);
}
