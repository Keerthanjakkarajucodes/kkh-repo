/**
 * LintCanvas – `lintcanvas fix` command
 * Generates proposed patches from the latest check report.
 * With --apply: applies validated patches to source files.
 */

import path from "path";
import chalk from "chalk";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { loadConfig, loadLatestReport, resolveOutputDir } from "../config.js";
import { buildPatchForFinding, applyPatch } from "../patch.js";
import { logger } from "../logger.js";
import type { Patch, CheckReport } from "../types.js";

export interface FixOptions {
  apply?: boolean;
  yes?: boolean; // non-interactive mode (skip confirmation prompt)
  reportPath?: string;
}

export async function runFix(options: FixOptions = {}): Promise<{ exitCode: number }> {
  const cfg = loadConfig();
  logger.header(`LintCanvas — Fix${options.apply ? " (Apply)" : " (Propose)"}`);

  // Load latest report
  const report = options.reportPath
    ? (JSON.parse(readFileSync(options.reportPath, "utf-8")) as CheckReport)
    : (loadLatestReport(cfg) as CheckReport | null);

  if (!report) {
    logger.error(
      "No check report found. Run `lintcanvas check` first to generate findings."
    );
    return { exitCode: 1 };
  }

  const actionableFindings = report.findings.filter(
    (f) => !f.requiresHumanReview && f.candidateProperty && f.proposedNewValue
  );
  const reviewFindings = report.findings.filter((f) => f.requiresHumanReview);

  if (reviewFindings.length > 0) {
    logger.warn(
      `${reviewFindings.length} finding${reviewFindings.length !== 1 ? "s" : ""} require human review (skipped):`
    );
    for (const f of reviewFindings) {
      logger.plain(`  ${chalk.yellow("⚠")} [${f.id}] ${f.description}`);
    }
  }

  if (actionableFindings.length === 0) {
    logger.info("No actionable findings to fix.");
    if (report.findings.length > 0) {
      logger.info("All findings require human review. See report for details.");
    }
    return { exitCode: 0 };
  }

  logger.info(`Building patches for ${actionableFindings.length} finding(s)...`);

  const patchesDir = path.join(resolveOutputDir(cfg), "patches");
  if (!existsSync(patchesDir)) mkdirSync(patchesDir, { recursive: true });

  const backupsDir = path.join(patchesDir, "backups");
  if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true });

  const patches: Patch[] = [];

  for (const finding of actionableFindings) {
    logger.info(`  Building patch for [${finding.id}]: ${finding.description}`);
    try {
      const patch = await buildPatchForFinding(finding, cfg.projectRoot, patchesDir);
      if (patch) {
        patches.push(patch);
        logger.plain("");
        logger.plain(chalk.cyan(`  Proposed patch for ${finding.id}:`));
        logger.plain(chalk.gray("  " + "─".repeat(56)));
        for (const line of patch.diff.split("\n").slice(0, 30)) {
          if (line.startsWith("+")) logger.plain(chalk.green(`  ${line}`));
          else if (line.startsWith("-")) logger.plain(chalk.red(`  ${line}`));
          else logger.plain(chalk.gray(`  ${line}`));
        }
        logger.plain(chalk.gray("  " + "─".repeat(56)));
      }
    } catch (e) {
      logger.warn(`  Failed to build patch for ${finding.id}: ${(e as Error).message}`);
    }
  }

  if (patches.length === 0) {
    logger.warn("No patches could be generated. Source locations may not be in CSS files.");
    return { exitCode: 0 };
  }

  // Save proposed patches JSON
  const proposedPath = path.join(patchesDir, "proposed-fix.json");
  writeFileSync(proposedPath, JSON.stringify(patches, null, 2) + "\n");
  logger.info(`Proposed patches saved: ${path.relative(cfg.projectRoot, proposedPath)}`);

  // Save diff file
  const allDiffs = patches.map((p) => p.diff).join("\n\n");
  const diffPath = path.join(patchesDir, "proposed-fix.diff");
  writeFileSync(diffPath, allDiffs, "utf-8");
  logger.info(`Diff file: ${path.relative(cfg.projectRoot, diffPath)}`);

  if (!options.apply) {
    logger.plain("");
    logger.info(`Review the diff above, then run: lintcanvas fix --apply`);
    return { exitCode: 0 };
  }

  // === Apply mode ===
  if (!options.yes) {
    logger.plain("");
    logger.warn(
      `About to apply ${patches.length} patch${patches.length !== 1 ? "es" : ""} to source files.\n` +
        "Backups will be created. Run `lintcanvas verify` afterwards to check for regressions.\n" +
        `Proceed? (y/N) `
    );

    // In CI or non-interactive mode, require --yes
    const { createInterface } = await import("readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer: string = await new Promise((resolve) =>
      rl.question("", (a) => {
        rl.close();
        resolve(a);
      })
    );
    if (!answer.trim().toLowerCase().startsWith("y")) {
      logger.info("Aborted. No files changed.");
      return { exitCode: 0 };
    }
  }

  let applied = 0;
  const appliedPatches: Patch[] = [];

  for (const patch of patches) {
    const absFile = path.join(cfg.projectRoot, patch.file);
    if (!existsSync(absFile)) {
      logger.warn(`  File not found: ${patch.file} — skipping`);
      continue;
    }
    try {
      logger.info(`  Applying: ${patch.file} { ${patch.property}: ${patch.oldValue} → ${patch.newValue} }`);
      const { diff, backupPath } = applyPatch(
        absFile,
        patch.selector,
        patch.property,
        patch.oldValue,
        patch.newValue,
        backupsDir
      );
      patch.applied = true;
      patch.backupPath = path.relative(cfg.projectRoot, backupPath);
      patch.diff = diff;
      applied++;
      appliedPatches.push(patch);
      logger.success(`  Applied (backup: ${path.relative(cfg.projectRoot, backupPath)})`);
    } catch (e) {
      logger.error(`  Failed to apply patch for ${patch.findingId}: ${(e as Error).message}`);
    }
  }

  // Save updated patches JSON with applied status
  writeFileSync(proposedPath, JSON.stringify(patches, null, 2) + "\n");

  logger.divider();
  logger.success(`Applied ${applied}/${patches.length} patches`);
  if (applied > 0) {
    logger.info("Run `lintcanvas verify` to check that the fixes improved the UI without regressions.");
  }

  return { exitCode: 0 };
}
