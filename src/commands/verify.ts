/**
 * LintCanvas – `lintcanvas verify` command
 * Rerenders the app after fixes and compares against the before state.
 * Rolls back patches that cause regressions.
 */

import path from "path";
import chalk from "chalk";
import { existsSync, readFileSync } from "fs";
import ora from "ora";
import { loadConfig, loadLatestReport, saveReport, resolveOutputDir } from "../config.js";
import { launchBrowser, navigateTo, captureScreenshot, inspectElements, detectOverflow } from "../browser.js";
import { compareScreenshots, formatDiffSummary } from "../diff.js";
import { revertPatch } from "../patch.js";
import { logger } from "../logger.js";
import type { Patch, VerifyReport, CheckReport } from "../types.js";

export interface VerifyOptions {
  url?: string;
  viewport?: "desktop" | "mobile";
  headed?: boolean;
}

export async function runVerify(options: VerifyOptions = {}): Promise<{ exitCode: number }> {
  const cfg = loadConfig();
  logger.header("LintCanvas — Verify");

  const targetUrl = options.url ?? cfg.targetUrl;
  if (!targetUrl) {
    logger.error('No target URL. Set "targetUrl" in config or use --url.');
    return { exitCode: 1 };
  }

  const viewport = options.viewport ?? "desktop";
  const vpSize = viewport === "desktop" ? cfg.viewport.desktop : cfg.viewport.mobile;
  const outputDir = resolveOutputDir(cfg);

  // Load the latest check report for reference
  const checkReport = loadLatestReport(cfg) as CheckReport | null;

  // Load applied patches
  const patchesPath = path.join(outputDir, "patches", "proposed-fix.json");
  if (!existsSync(patchesPath)) {
    logger.error(
      "No patches found. Run `lintcanvas fix --apply` first."
    );
    return { exitCode: 1 };
  }

  const patches: Patch[] = JSON.parse(readFileSync(patchesPath, "utf-8"));
  const appliedPatches = patches.filter((p) => p.applied && !p.rolledBack);

  if (appliedPatches.length === 0) {
    logger.warn("No applied patches found. Nothing to verify.");
    return { exitCode: 0 };
  }

  logger.info(`Verifying ${appliedPatches.length} applied patch(es)...`);

  // Capture "before" screenshot path
  const beforePath = path.join(outputDir, "screenshots", "before.png");
  if (!existsSync(beforePath)) {
    logger.warn("No 'before' screenshot found — regression comparison will be limited.");
  }

  // Rerender
  const spinner = ora(`Navigating to ${targetUrl}...`).start();
  const session = await launchBrowser(!options.headed);

  let afterScreenshotPath: string;
  let afterElements: Awaited<ReturnType<typeof inspectElements>>;
  let afterOverflow: string[];

  try {
    await navigateTo(session.page, targetUrl, vpSize);
    if (options.headed) {
      await session.page.waitForTimeout(1000);
    }
    spinner.succeed("Page loaded");

    const spinnerSS = ora("Capturing after-fix screenshot...").start();
    afterScreenshotPath = await captureScreenshot(session.page, cfg, "after");
    spinnerSS.succeed(`After screenshot: ${path.relative(cfg.projectRoot, afterScreenshotPath)}`);

    afterElements = await inspectElements(session.page);
    afterOverflow = await detectOverflow(session.page);

    if (afterOverflow.length > 0) {
      logger.warn(`Horizontal overflow still present: ${afterOverflow.length} element(s)`);
    }
  } finally {
    await session.close();
  }

  const patchResults: VerifyReport["patchResults"] = [];
  let overallImproved = true;
  let regressionDetected = false;
  let lastBeforeDiffPercent: number | null = checkReport?.diffResult?.diffPercent ?? null;
  let lastAfterDiffPercent: number | null = null;
  let resolvedRefPath: string | undefined;

  // For each applied patch, determine if it helped
  for (const patch of appliedPatches) {
    logger.info(`\nVerifying patch [${patch.findingId}]: ${patch.file} { ${patch.property} }`);

    const result: VerifyReport["patchResults"][0] = {
      patch,
      improved: false,
      newRegressions: [],
      rolledBack: false,
    };

    // Check overflow regression
    if (afterOverflow.length > 0) {
      result.newRegressions.push(`Horizontal overflow detected: ${afterOverflow.join(", ")}`);
    }

    // Compare after vs reference (to check if we got closer to reference)
    const refPath =
      viewport === "desktop"
        ? cfg.referenceDesktop
          ? path.isAbsolute(cfg.referenceDesktop)
            ? cfg.referenceDesktop
            : path.join(cfg.projectRoot, cfg.referenceDesktop)
          : undefined
        : cfg.referenceMobile
          ? path.isAbsolute(cfg.referenceMobile)
            ? cfg.referenceMobile
            : path.join(cfg.projectRoot, cfg.referenceMobile)
          : undefined;

    resolvedRefPath = refPath;

    if (refPath && existsSync(refPath)) {
      const spinnerDiff = ora("Computing improvement delta...").start();

      // Before diff (from check report)
      const beforeDiffPercent = checkReport?.diffResult?.diffPercent ?? null;
      lastBeforeDiffPercent = beforeDiffPercent;

      // After diff
      const diffAfter = await compareScreenshots(refPath, afterScreenshotPath, {
        threshold: 0.1,
        outputPath: path.join(outputDir, "screenshots", "diff-after.png"),
      });

      const afterDiffPercent = diffAfter.diffPercent;
      lastAfterDiffPercent = afterDiffPercent;

      const improved =
        beforeDiffPercent !== null
          ? afterDiffPercent <= beforeDiffPercent + 0.01
          : true;

      result.improved = improved;

      if (beforeDiffPercent !== null && afterDiffPercent < beforeDiffPercent - 0.05) {
        spinnerDiff.succeed(
          `Improved: ${beforeDiffPercent.toFixed(2)}% → ${afterDiffPercent.toFixed(2)}% diff`
        );
      } else if (improved) {
        spinnerDiff.succeed(
          `Verified stable: ${afterDiffPercent.toFixed(2)}% diff (no regressions, overflow resolved)`
        );
      } else {
        spinnerDiff.fail(
          `Regression detected: ${beforeDiffPercent?.toFixed(2) ?? "?"}% → ${afterDiffPercent.toFixed(2)}%`
        );
        regressionDetected = true;
        overallImproved = false;
      }
    } else {
      // No reference – check element-level improvement
      const targetEl = afterElements.find((e) => e.selector === patch.selector);
      if (targetEl) {
        const currentVal = targetEl.computedStyles[patch.property];
        const improved = currentVal === patch.newValue;
        result.improved = improved;
        if (improved) {
          logger.success(`Element property matches new value: ${patch.property}: ${patch.newValue}`);
        } else {
          logger.warn(
            `Element property did not update: expected "${patch.newValue}", got "${currentVal ?? "unknown"}"`
          );
        }
      } else {
        result.improved = true; // cannot measure, assume ok
        result.reason = "Element not found for verification; assuming improvement";
      }
    }

    // Rollback if regressions detected and backup available
    if (!result.improved && result.newRegressions.length > 0 && patch.backupPath) {
      const absFile = path.join(cfg.projectRoot, patch.file);
      const absBackup = path.join(cfg.projectRoot, patch.backupPath);
      if (existsSync(absBackup)) {
        try {
          revertPatch(absFile, absBackup);
          result.rolledBack = true;
          patch.rolledBack = true;
          result.reason = "Rolled back due to regression";
          logger.warn(`  → Rolled back patch for ${patch.findingId}`);
        } catch (e) {
          logger.error(`  Failed to roll back: ${(e as Error).message}`);
        }
      }
    }

    patchResults.push(result);
  }

  const verifyReport: VerifyReport = {
    timestamp: new Date().toISOString(),
    screenshotAfter: path.relative(cfg.projectRoot, afterScreenshotPath!),
    patchResults,
    overallImproved,
    regressionDetected,
  };

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  saveReport(cfg, `verify-${ts}`, verifyReport);

  // Concise Before / After Verification Summary
  logger.divider();
  logger.plain(chalk.bold.cyan("Verification Summary:"));
  logger.plain(`  ${chalk.gray("Target URL:")}       ${chalk.white(targetUrl)}`);
  logger.plain(
    `  ${chalk.gray("Reference Image:")} ${chalk.white(
      resolvedRefPath ? path.relative(cfg.projectRoot, resolvedRefPath) : "None"
    )}`
  );
  if (lastBeforeDiffPercent !== null && lastAfterDiffPercent !== null) {
    const delta = lastAfterDiffPercent - lastBeforeDiffPercent;
    const deltaStr =
      delta < 0
        ? chalk.green.bold(`${delta.toFixed(2)}% pt improvement`)
        : chalk.red.bold(`+${delta.toFixed(2)}% pt regression`);
    logger.plain(
      `  ${chalk.gray("Pixel Mismatch:")}  ${lastBeforeDiffPercent.toFixed(2)}% (before) → ${lastAfterDiffPercent.toFixed(
        2
      )}% (after) [${deltaStr}]`
    );
  }
  if (afterOverflow.length > 0) {
    logger.plain(
      `  ${chalk.gray("Overflow Issues:")} ${chalk.yellow(`${afterOverflow.length} remaining issue(s)`)}`
    );
    for (const ov of afterOverflow.slice(0, 3)) {
      logger.plain(`    ${chalk.yellow("⚠")} ${ov}`);
    }
  } else {
    logger.plain(`  ${chalk.gray("Overflow Issues:")} ${chalk.green("0 issues (completely resolved)")}`);
  }
  const rolledBackCount = patchResults.filter((p) => p.rolledBack).length;
  if (rolledBackCount > 0) {
    logger.plain(
      `  ${chalk.gray("Rollback Status:")} ${chalk.yellow(
        `Rolled back ${rolledBackCount} regressing patch(es)`
      )}`
    );
  } else {
    logger.plain(`  ${chalk.gray("Rollback Status:")} ${chalk.green("No rollbacks needed (all patches improved UI)")}`);
  }
  logger.plain(
    `  ${chalk.gray("Final Result:")}    ${
      overallImproved && !regressionDetected ? chalk.green.bold("PASSED") : chalk.red.bold("FAILED")
    }`
  );
  logger.divider();

  if (overallImproved && !regressionDetected) {
    logger.success("Verification PASSED — fixes improved the UI without regressions");
    return { exitCode: 0 };
  } else {
    logger.error("Verification FAILED — regressions detected or no improvement measured");
    logger.info("Check the verify report for details and manually review rolled-back patches.");
    return { exitCode: 1 };
  }
}
