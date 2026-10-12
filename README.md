# LintCanvas

**AI-powered UI regression detection and verified repair CLI**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js ≥18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Powered by Gemma 4](https://img.shields.io/badge/AI-Gemma%204-orange)](https://ai.google.dev/gemma)

LintCanvas is an open-source CLI that helps developers catch and fix visual regressions before users do. It compares a Figma-exported design reference against a live rendered web page, measures pixel-level differences, inspects DOM elements for evidence, sends relevant visual and structural context to **Gemma 4** for diagnosis, proposes minimal CSS patches, and verifies that applied fixes actually improve the result — rolling back automatically if they cause regressions.

---

## ⚡ 60-Second Judge Demo Sequence

Want to see LintCanvas in action immediately? Follow this quick demo:

```bash
# 1. Start the sample app (runs on port 5173)
npm --prefix sample-app run dev

# 2. Run the AI check against the reference design (headed mode opens visible browser)
npx tsx src/cli.ts check --url http://localhost:5173 --reference "./sample-app/reference/desktop.png" --headed

# 3. Preview targeted CSS repairs proposed by Gemma 4
npx tsx src/cli.ts fix

# 4. Apply repairs and verify UI improvement with rollback safety
npx tsx src/cli.ts fix --apply --yes
npx tsx src/cli.ts verify --headed
```

---

## The Problem & The Solution

- **The Problem**: Visual bugs (clipping, misaligned grids, squished navigation, oversized text) slip into production because traditional test suites only test DOM structure or basic pixel snapshots without understanding *why* the design broke or *how* to fix it.
- **The Solution**: LintCanvas combines **deterministic browser measurement** (Playwright + pixelmatch + DOM bounding boxes) with **Gemma 4 multimodal intelligence** to diagnose the exact CSS root cause, propose surgical CSS patches, and verify improvements before keeping them.

---

## Why Gemma 4 for Multimodal UI Diagnosis?

Gemma 4 is the ideal open-source foundation for visual UI regression engineering:
1. **Multimodal Dual-Image Comprehension**: Gemma 4 natively accepts and compares both the high-fidelity Figma reference PNG (Image 1) and the live browser screenshot (Image 2) simultaneously.
2. **Visual-to-Code Grounding**: By coupling pixel mismatch regions with actual computed DOM styles and bounding boxes, Gemma 4 maps visual regressions directly to the responsible CSS selector and property.
3. **Structured Instruction Following**: Gemma 4 reliably outputs validated JSON conforming to our strict Zod schema, ensuring zero hallucinated CSS rewrites.

---

## Architecture & Data Flow

```
┌─────────────────────────── DETERMINISTIC PIPELINE ──────────────────────────┐
│                                                                             │
│  [Reference PNG] ──┐                                                        │
│                    ├──> [Pixelmatch Diff] ──> Diff Regions & % Mismatch    │
│  [Live Page URL] ──┘                                      │                 │
│         │                                                 │                 │
│         ▼                                                 │                 │
│  [Playwright Capture] ──> [DOM Inspection] ──> Element Rects & Overflow     │
│                                                           │                 │
└───────────────────────────────────────────────────────────┼─────────────────┘
                                                            ▼
┌─────────────────────────── GEMMA 4 AI DIAGNOSIS ────────────────────────────┐
│                                                                             │
│  Reference Image + Live Screenshot + Visual Diff + DOM Metrics              │
│                           │                                                 │
│                           ▼                                                 │
│             [Gemma 4 Multimodal Model]                                      │
│                           │                                                 │
│                           ▼                                                 │
│          [Zod Schema Validation & Filtering]                                │
│                           │                                                 │
│                           ▼                                                 │
│          [Structured Findings & Proposed CSS]                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────── VERIFIED REPAIR LOOP ────────────────────────────┐
│                                                                             │
│  [PostCSS Source Patch] ──> [Timestamped Backup] ──> [Apply CSS Changes]    │
│                                                             │               │
│                                                             ▼               │
│  [Automated Rollback] <── [Verify Regression] <── [Rerender & Fresh Diff]   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## The Workflow

```
Design PNG → Browser render → Pixel diff → DOM inspection
    → Gemma 4 diagnosis → Minimal CSS patch → Diff review
    → Apply with backup → Verified rerender → Rollback if regression
```

LintCanvas is **not** another "describe my screenshot" wrapper. Its core differentiator is the verified repair loop: every proposed change is measured, applied to source, rerendered, and checked against the original diff before being kept.

---

## Features

| Feature | Details |
|---|---|
| **Pixel-level diff** | [pixelmatch](https://github.com/mapbox/pixelmatch) compares reference vs rendered, outputs diff PNG with region detection |
| **DOM measurement** | Bounding boxes, computed styles, overflow detection for up to 120 visible elements |
| **Gemma 4 analysis** | Multimodal model interprets images + DOM data, returns structured JSON findings |
| **Schema validation** | Every model response is validated with [Zod](https://zod.dev) before use |
| **Source-aware patches** | [PostCSS](https://postcss.org) locates the exact CSS declaration; only safe properties are edited |
| **Verified repair** | Patches are re-rendered and measured; failing patches are automatically reverted |
| **Desktop + mobile** | Two separate viewport checks when mobile reference is provided |
| **CI-friendly** | JSON reports, nonzero exit code on failure, `--no-ai` flag for fast screenshot-only runs |
| **Deterministic benchmark** | 15 known-answer test cases with precision/recall/repair metrics |

---

## Installation

### Global install (recommended for local use)

```bash
npm install -g lintcanvas
```

### As a project dev dependency

```bash
npm install --save-dev lintcanvas
```

### From source

```bash
git clone https://github.com/your-org/lintcanvas
cd lintcanvas
npm install
npm run build
node dist/cli.js --help
```

---

## Prerequisites

- **Node.js ≥ 18**
- **Playwright Chromium** — `npx playwright install chromium`
- **Google Gemini API key** — https://aistudio.google.com/ (free tier available)
  - AI analysis is optional. Screenshot comparison and DOM inspection work without a key.

---

## Setup

```bash
# 1. Initialise in your project root
cd my-react-app
lintcanvas init

# 2. Copy and fill in your API key
cp .env.example .env
#   GEMINI_API_KEY=your_key_here

# 3. Edit lintcanvas.config.json
#   - Set "targetUrl" to your dev server
#   - Set "referenceDesktop" to your Figma export PNG
```

### Example `lintcanvas.config.json`

```json
{
  "version": "1",
  "targetUrl": "http://localhost:5173",
  "devCommand": "npm run dev",
  "devPort": 5173,
  "referenceDesktop": "design/desktop-reference.png",
  "referenceMobile": "design/mobile-reference.png",
  "viewport": {
    "desktop": { "width": 1280, "height": 800 },
    "mobile": { "width": 375, "height": 812 }
  },
  "designRules": [
    "Max content width is 1200px",
    "Primary brand color is #6366f1"
  ],
  "gemmaModel": "gemma-4-31b-it",
  "outputDir": ".lintcanvas",
  "ci": {
    "failOnWarnings": false,
    "maxMismatchPercent": 5
  }
}
```

---

## Commands

### `lintcanvas init`

Detects your project, creates a starter config, appends `.lintcanvas/` to `.gitignore`, and checks whether Playwright and your API key are configured.

```bash
lintcanvas init
lintcanvas init --force   # overwrite existing config
```

---

### `lintcanvas check`

Captures a screenshot, runs a pixel diff against your reference, inspects the DOM, and calls Gemma 4 for diagnosis.

```bash
lintcanvas check
lintcanvas check --url http://localhost:3000
lintcanvas check --reference design/v2.png
lintcanvas check --viewport mobile
lintcanvas check --viewport both        # desktop + mobile
lintcanvas check --no-ai                # screenshot + DOM only
```

Output:

- `.lintcanvas/screenshots/before.png`
- `.lintcanvas/screenshots/diff.png` (highlighted mismatches)
- `.lintcanvas/reports/check-desktop-<timestamp>.json`
- `.lintcanvas/reports/latest.json`

---

### `lintcanvas fix`

Reads the latest check report and proposes CSS patches for actionable findings. Displays the exact diff before applying anything.

```bash
lintcanvas fix              # propose only – shows diff, writes .diff file
lintcanvas fix --apply      # apply patches (asks for confirmation)
lintcanvas fix --apply --yes  # non-interactive, skip prompt
```

Patches:

- Are backed up before application
- Only modify the specific CSS declaration that was found
- Never touch HTML, JSX, Tailwind classes, or JS
- Are rejected if the property is not in the safe list

Output: `.lintcanvas/patches/proposed-fix.diff`

---

### `lintcanvas verify`

Re-renders the page after a fix, computes a new diff against the reference, and measures whether the issue improved. Rolls back patches that cause regressions.

```bash
lintcanvas verify
lintcanvas verify --url http://localhost:3000 --viewport mobile
```

Output: `.lintcanvas/reports/verify-<timestamp>.json`  
Exit code: `0` if improved and no regressions, `1` otherwise.

---

### `lintcanvas benchmark`

Runs the built-in 15-case known-answer dataset and reports detection precision, recall, repair success rate, and regression rate.

```bash
lintcanvas benchmark
lintcanvas benchmark --cases-dir ./my-benchmark-cases
```

---

## Output structure

```
.lintcanvas/
├── config.json              (unused – config lives at root)
├── reports/
│   ├── latest.json
│   ├── check-desktop-<ts>.json
│   ├── verify-<ts>.json
│   └── benchmark-<ts>.json
├── screenshots/
│   ├── before.png
│   ├── before-mobile.png
│   ├── diff.png
│   └── after.png
└── patches/
    ├── proposed-fix.json
    ├── proposed-fix.diff
    └── backups/
        └── *.bak
```

`.lintcanvas/` is added to `.gitignore` by `lintcanvas init`. You may opt in for sharing benchmark artifacts.

---

## Privacy

LintCanvas sends the following to the Gemini API:

- The reference PNG image (your design export)
- The rendered page screenshot
- Summarised DOM measurements (element rects, computed styles)
- Any design rules you configured

LintCanvas does **not** send your entire codebase, environment variables, API keys, or any other files.

This tool uses a hosted model API (Google Gemini). It is **not** fully offline. If this is a concern, use `--no-ai` mode, which performs only local screenshot comparison and DOM inspection.

---

## Supported CSS properties (safe repair set)

LintCanvas only proposes changes to properties in this list:

`margin`, `margin-top`, `margin-right`, `margin-bottom`, `margin-left`, `padding`, `padding-top`, `padding-right`, `padding-bottom`, `padding-left`, `gap`, `row-gap`, `column-gap`, `width`, `max-width`, `min-width`, `height`, `max-height`, `min-height`, `font-size`, `line-height`, `letter-spacing`, `text-align`, `flex-direction`, `align-items`, `justify-content`, `flex-wrap`, `flex-grow`, `flex-shrink`, `flex-basis`, `grid-template-columns`, `grid-template-rows`, `overflow`, `overflow-x`, `overflow-y`, `display`, `position`, `top`, `right`, `bottom`, `left`, `z-index`, `border-radius`, `opacity`, `visibility`, `object-fit`

Anything else (animations, custom properties, arbitrary JS changes, Tailwind utilities) requires human review.

---

## Architecture

```
CLI (Commander.js)
├── init         → Project detection, config scaffolding
├── check        → Browser → Screenshot → Diff → DOM → AI
│                   └── GemmaClient → Zod validation → Report
├── fix          → Report → PostCSS search → Diff preview → Apply
├── verify       → Browser → Screenshot → Diff → Regression check → Rollback
└── benchmark    → Case files → Deterministic checks → Metrics
```

---

## Limitations (v0.1)

- Supports **React + Vite** projects with plain CSS or CSS Modules.
- Tailwind utility classes are not rewritten; findings requiring Tailwind changes are flagged for human review.
- CSS-in-JS (styled-components, Emotion) source mapping is not yet supported.
- Reference images must be exported Figma PNGs. Figma API integration is not included.
- The tool does not start your dev server automatically. You must start it before running `check`.
- AI analysis requires a Gemini API key with access to Gemma 4 models. Not all keys have access to all model tiers.

---

## Model information

LintCanvas uses **Gemma 4** from Google DeepMind.

| Model | Notes |
|---|---|
| `gemma-4-31b-it` | Default, highest quality |
| `gemma-4-26b-a4b-it` | MoE, efficient |
| `gemma-4-e4b-it` | Edge, fastest |

Gemma 4 is released under the **Apache 2.0 License**.
- Model card: https://ai.google.dev/gemma
- License terms: https://ai.google.dev/gemma/terms

The model identifier is configurable via `GEMMA_MODEL` in your `.env` file. If the configured model is unavailable on your account, LintCanvas will report a clear error with instructions.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
