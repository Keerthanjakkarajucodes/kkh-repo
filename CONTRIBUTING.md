# Contributing to LintCanvas

Thank you for your interest in contributing to LintCanvas! This document explains how to set up the project locally and submit changes.

## Development setup

```bash
git clone https://github.com/your-org/lintcanvas
cd lintcanvas
npm install
npx playwright install chromium
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

Run tests:

```bash
npm test            # unit tests only (no browser, no API)
npm run test:watch  # watch mode
```

Build the CLI:

```bash
npm run build
node dist/cli.js --help
```

Run the sample app:

```bash
cd sample-app && npm install && npm run dev
```

## Project structure

```
src/
  cli.ts              Entry point (Commander.js)
  types.ts            Zod schemas + TypeScript types
  config.ts           Config loader / writer
  logger.ts           Coloured console output
  browser.ts          Playwright browser management
  diff.ts             Pixel-level image comparison (pixelmatch)
  ai.ts               Gemma 4 / Gemini AI client
  patch.ts            CSS patch engine (PostCSS)
  commands/
    init.ts
    check.ts
    fix.ts
    verify.ts
    benchmark.ts

tests/                Unit tests (Vitest)
benchmark/cases/      Known-answer benchmark dataset
sample-app/           React + Vite sample app with intentional CSS bugs
```

## Guidelines

- All source files are TypeScript; no `any` unless unavoidable.
- New commands go in `src/commands/`.
- Any new AI output must go through a Zod schema validator. Do not trust raw model output.
- New CSS property support must be added to the `SAFE_PROPERTIES` set in `src/ai.ts`.
- Add a Vitest test for any new utility function.
- Follow the existing code style (no semi at end of config/JSON files; TypeScript-first).
- Do not commit `.env` or any files under `.lintcanvas/`.

## Submitting a pull request

1. Fork the repository.
2. Create a branch: `git checkout -b fix/my-fix`.
3. Make your changes with tests.
4. Run `npm test` and ensure all pass.
5. Open a PR with a clear description.

## Benchmark cases

When adding a new benchmark case:

1. Add a `BC-XXX.json` file in `benchmark/cases/`.
2. The case must have a deterministic expected outcome – do not rely on AI for benchmark evaluation.
3. Document what bug you are testing and what the expected result is.

## Model attribution

LintCanvas uses **Gemma 4** models from Google DeepMind, available under the Apache 2.0 License:
- Model card: https://ai.google.dev/gemma
- License: https://ai.google.dev/gemma/terms

LintCanvas does NOT include model weights. It calls the Gemini API with your own API key.
