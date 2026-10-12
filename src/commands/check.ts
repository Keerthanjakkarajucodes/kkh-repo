/**
 * LintCanvas – `lintcanvas check` command
 * The main analysis pipeline.
 */

import path from "path";
import chalk from "chalk";
import { existsSync } from "fs";
import ora from "ora";
import { loadConfig, saveReport, ensureOutputDirs, resolveOutputDir } from "../config.js";
import { launchBrowser, navigateTo, captureScreenshot, inspectElements, detectOverflow, saveElementsJson } from "../browser.js";
import { compareScreenshots, formatDiffSummary } from "../diff.js";
import { createGemmaClient } from "../ai.js";
import { logger } from "../logger.js";
import type { CheckReport } from "../types.js";

export interface CheckOptions {
  url?: string;
  reference?: string;
  viewport?: "desktop" | "mobile" | "both";
  output?: string;
  noAi?: boolean;
  headed?: boolean;
}

export async function runCheck(options: CheckOptions = {}): Promise<{ exitCode: number }> {
  const cfg = loadConfig();
  ensureOutputDirs(cfg);

  const targetUrl = options.url ?? cfg.targetUrl;
  if (!targetUrl) {
    logger.error(
      'No target URL configured.\n' +
        'Set "targetUrl" in lintcanvas.config.json or use: lintcanvas check --url <url>'
    );
    return { exitCode: 1 };
  }

  const viewportMode: "desktop" | "mobile" | "both" =
    options.viewport ?? "desktop";
  const viewports: Array<"desktop" | "mobile"> =
    viewportMode === "both" ? ["desktop", "mobile"] : [viewportMode];

  let overallPass = true;

  for (const vp of viewports) {
    logger.header(`LintCanvas — Check (${vp})`);
    const result = await runCheckForViewport(cfg, targetUrl, vp, options);
    if (!result.passedCI) overallPass = false;
  }

  return { exitCode: overallPass ? 0 : 1 };
}

async function runCheckForViewport(
  cfg: ReturnType<typeof loadConfig>,
  targetUrl: string,
  viewport: "desktop" | "mobile",
  options: CheckOptions
) {
  const vpSize = viewport === "desktop" ? cfg.viewport.desktop : cfg.viewport.mobile;
  const referenceImage =
    options.reference ??
    (viewport === "desktop" ? cfg.referenceDesktop : cfg.referenceMobile);

  const outputDir = resolveOutputDir(cfg);
  const screenshotName = viewport === "desktop" ? "before" : `before-mobile`;
  const diffName = viewport === "desktop" ? "diff" : "diff-mobile";

  const steps = referenceImage ? 6 : 4;
  let step = 0;

  // Step 1 – Capture screenshot
  const spinnerNav = ora(`Navigating to ${targetUrl}...`).start();
  let session: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  let screenshotPath = "";

  try {
    const headless = !options.headed;
    session = await launchBrowser(headless);
    await navigateTo(session.page, targetUrl, vpSize);
    if (options.headed) {
      await session.page.waitForTimeout(1000); // Allow visual observation in headed mode
    }
    spinnerNav.succeed(`Page loaded at ${vpSize.width}×${vpSize.height}`);

    // Step 2 – Screenshot
    const spinnerSS = ora("Capturing screenshot...").start();
    screenshotPath = await captureScreenshot(session.page, cfg, screenshotName);
    spinnerSS.succeed(`Screenshot: ${path.relative(cfg.projectRoot, screenshotPath)}`);
    step = 2;

    // Step 3 – Inspect DOM
    const spinnerDOM = ora("Inspecting DOM elements...").start();
    const elements = await inspectElements(session.page);
    const overflowWarnings = await detectOverflow(session.page);
    saveElementsJson(cfg, elements);
    spinnerDOM.succeed(
      `Inspected ${elements.length} elements` +
        (overflowWarnings.length > 0 ? chalk.yellow(` — ${overflowWarnings.length} overflow issues`) : "")
    );

    if (overflowWarnings.length > 0) {
      logger.warn("Horizontal overflow detected:");
      for (const w of overflowWarnings) {
        logger.plain(`  ${chalk.yellow("⚠")} ${w}`);
      }
    }
    step = 3;

    // Step 4 – Visual diff (only if reference exists)
    let diffResult: Awaited<ReturnType<typeof compareScreenshots>> | undefined;
    let referencePathAbs: string | undefined;

    if (referenceImage) {
      referencePathAbs = path.isAbsolute(referenceImage)
        ? referenceImage
        : path.join(cfg.projectRoot, referenceImage);

      if (!existsSync(referencePathAbs)) {
        logger.warn(
          `Reference image not found: ${referencePathAbs}\n` +
            "Skipping pixel-level comparison."
        );
      } else {
        const spinnerDiff = ora("Computing visual diff...").start();
        const diffOutputPath = path.join(outputDir, "screenshots", `${diffName}.png`);
        diffResult = await compareScreenshots(referencePathAbs, screenshotPath, {
          threshold: 0.1,
          outputPath: diffOutputPath,
        });
        const summary = formatDiffSummary(diffResult);
        if (diffResult.diffPercent < cfg.ci.maxMismatchPercent) {
          spinnerDiff.succeed(summary);
        } else {
          spinnerDiff.fail(`${summary} (exceeds ${cfg.ci.maxMismatchPercent}% threshold)`);
        }
        step = 4;
      }
    } else {
      logger.info("No reference image configured — skipping pixel diff. (Set referenceDesktop in config.)");
    }

    // Step 5 – AI analysis
    let aiResponse: { findings: CheckReport["findings"]; summary: string } = {
      findings: [],
      summary: "AI diagnosis skipped: No GEMINI_API_KEY configured. Report contains deterministic visual diff only.",
    };

    const useAi = !options.noAi && !process.env["LINTCANVAS_DRY_RUN"];

    let diagnosedModel = cfg.gemmaModel;

    if (useAi) {
      const client = createGemmaClient(cfg);
      if (client) {
        const spinnerAI = ora(`Diagnosing with ${client.getModelName()}...`).start();
        try {
          aiResponse = await client.analyzeUI(
            cfg,
            referencePathAbs,
            screenshotPath,
            diffResult,
            elements,
            overflowWarnings,
            viewport
          );
          diagnosedModel = client.getModelName();
          spinnerAI.succeed(
            `AI diagnosis complete (${diagnosedModel}) — ${aiResponse.findings.length} finding${aiResponse.findings.length !== 1 ? "s" : ""}`
          );
        } catch (e) {
          spinnerAI.fail(`AI diagnosis failed: ${(e as Error).message}`);
          logger.warn("Continuing without AI diagnosis.");
          aiResponse.summary = `AI diagnosis failed: ${(e as Error).message}. Deterministic visual diff only.`;
        }
      } else {
        aiResponse.summary = "AI diagnosis skipped: No GEMINI_API_KEY configured. Report contains deterministic visual diff only.";
      }
    } else {
      aiResponse.summary = "AI diagnosis skipped: --no-ai flag provided. Report contains deterministic visual diff only.";
    }

    // Step 6 – Build and save report
    const passedCI =
      (diffResult ? diffResult.diffPercent < cfg.ci.maxMismatchPercent : true) &&
      (!cfg.ci.failOnWarnings ||
        aiResponse.findings.filter((f) => f.severity === "error").length === 0);

    const report: CheckReport = {
      timestamp: new Date().toISOString(),
      config: cfg,
      screenshotBefore: path.relative(cfg.projectRoot, screenshotPath),
      referenceScreenshot: referencePathAbs
        ? path.relative(cfg.projectRoot, referencePathAbs)
        : undefined,
      diffResult,
      findings: aiResponse.findings,
      summary: aiResponse.summary,
      passedCI,
      viewport,
    };

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = saveReport(cfg, `check-${viewport}-${ts}`, report);
    logger.divider();
    logger.info(`Report saved: ${path.relative(cfg.projectRoot, reportPath)}`);

    // Print findings
    if (aiResponse.findings.length > 0) {
      logger.plain("");
      logger.plain(chalk.bold.cyan(`AI Findings (${diagnosedModel}):`));
      for (const f of aiResponse.findings) {
        const sevColor =
          f.severity === "error" ? chalk.red.bold : f.severity === "warning" ? chalk.yellow.bold : chalk.blue.bold;
        const confBadge =
          f.confidence === "high"
            ? chalk.green("● high confidence")
            : f.confidence === "medium"
              ? chalk.yellow("● medium confidence")
              : chalk.gray("○ low confidence");
        const actionBadge = f.requiresHumanReview
          ? chalk.bgYellow.black(" REQUIRES HUMAN REVIEW ")
          : chalk.bgGreen.black(" SAFE TO AUTOMATE ");

        logger.plain("");
        logger.plain(
          `  ${sevColor(f.severity.toUpperCase())} ${chalk.bold(`[${f.id}]`)} ${chalk.white.bold(f.description)} ` +
            chalk.gray(`(${f.category})`)
        );
        logger.plain(`    ${chalk.gray("Target:")} ${chalk.cyan(f.selector)}  ${chalk.gray("|")}  ${confBadge}  ${actionBadge}`);
        if (f.evidence) {
          logger.plain(`    ${chalk.gray("Visual Evidence:")} ${chalk.italic(f.evidence)}`);
        }
        if (f.likelyCause) {
          logger.plain(`    ${chalk.gray("Likely Root Cause:")} ${f.likelyCause}`);
        }
        if (f.candidateProperty && f.proposedNewValue) {
          const changeStr = f.proposedOldValue
            ? `${f.proposedOldValue} → ${chalk.bold.green(f.proposedNewValue)}`
            : chalk.bold.green(f.proposedNewValue);
          logger.plain(
            `    ${chalk.gray("Proposed CSS:")} ${chalk.cyan(f.selector)} { ${chalk.yellow(f.candidateProperty)}: ${changeStr}; }` +
              (f.candidateFile ? chalk.gray(` (${f.candidateFile}${f.candidateLine ? ":" + f.candidateLine : ""})`) : "")
          );
        }
      }
    } else {
      logger.plain("");
      if (!process.env["GEMINI_API_KEY"] || !useAi) {
        logger.info(
          "AI diagnosis: Skipped (" +
            (!useAi ? "--no-ai flag" : "no GEMINI_API_KEY") +
            "). Visual mismatch and DOM overflow metrics above are deterministic."
        );
      } else {
        logger.info("AI diagnosis: 0 findings reported by model.");
      }
    }

    logger.plain("");
    if (passedCI) {
      logger.success("CI check PASSED");
    } else {
      logger.error("CI check FAILED");
    }

    if (!session) return { passedCI: false };
    await session.close();
    return { passedCI };
  } catch (e) {
    if (session) {
      try {
        await session.close();
      } catch {}
    }
    throw e;
  }
}
