#!/usr/bin/env node
/**
 * LintCanvas CLI – Entry point
 * Uses Commander.js to define all commands.
 */

import path from "path";
import { fileURLToPath } from "url";
import { config as dotenvConfig } from "dotenv";

const __cliDir = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: path.resolve(__cliDir, "..", ".env") });
dotenvConfig();

import { program } from "commander";
import chalk from "chalk";
import { setLogLevel } from "./logger.js";
import { runInit } from "./commands/init.js";
import { runCheck } from "./commands/check.js";
import { runFix } from "./commands/fix.js";
import { runVerify } from "./commands/verify.js";
import { runBenchmark } from "./commands/benchmark.js";

const VERSION = "0.1.0";

program
  .name("lintcanvas")
  .description(
    chalk.cyan("LintCanvas") +
      " — AI-powered UI regression detection and verified repair CLI\n" +
      chalk.gray("  Powered by Gemma 4 via Google Gemini API")
  )
  .version(VERSION)
  .option("-d, --debug", "Enable debug logging")
  .hook("preAction", (thisCommand) => {
    if (thisCommand.opts()["debug"]) {
      setLogLevel("debug");
    }
  });

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
program
  .command("init")
  .description("Create a starter lintcanvas.config.json and check prerequisites")
  .option("-f, --force", "Overwrite existing config")
  .action(async (opts: { force?: boolean }) => {
    await runInit({ force: opts.force });
  });

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------
program
  .command("check")
  .description("Capture, compare, and analyse the rendered page against your reference design")
  .option("-u, --url <url>", "Target URL (overrides config)")
  .option("-r, --reference <path>", "Reference image path (overrides config)")
  .option(
    "-v, --viewport <mode>",
    "Viewport mode: desktop | mobile | both (default: desktop)",
    "desktop"
  )
  .option("--no-ai", "Skip AI analysis (pixel diff only)")
  .option("--headed", "Open visible browser window instead of headless mode")
  .action(async (opts: { url?: string; reference?: string; viewport?: string; ai?: boolean; headed?: boolean }) => {
    try {
      const viewport = (opts.viewport ?? "desktop") as "desktop" | "mobile" | "both";
      const { exitCode } = await runCheck({
        url: opts.url,
        reference: opts.reference,
        viewport,
        noAi: opts.ai === false,
        headed: opts.headed,
      });
      process.exit(exitCode);
    } catch (e) {
      console.error(chalk.red("✖ " + (e as Error).message));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// fix
// ---------------------------------------------------------------------------
program
  .command("fix")
  .description("Propose (and optionally apply) CSS patches for findings from the latest check")
  .option("--apply", "Apply the proposed patches to source files")
  .option("-y, --yes", "Skip interactive confirmation (non-interactive mode)")
  .option("--report <path>", "Path to a specific check report JSON")
  .action(async (opts: { apply?: boolean; yes?: boolean; report?: string }) => {
    try {
      const { exitCode } = await runFix({
        apply: opts.apply,
        yes: opts.yes,
        reportPath: opts.report,
      });
      process.exit(exitCode);
    } catch (e) {
      console.error(chalk.red("✖ " + (e as Error).message));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------
program
  .command("verify")
  .description("Re-render the app after a fix and check whether the issue improved")
  .option("-u, --url <url>", "Target URL (overrides config)")
  .option("-v, --viewport <mode>", "desktop | mobile (default: desktop)", "desktop")
  .option("--headed", "Open visible browser window instead of headless mode")
  .action(async (opts: { url?: string; viewport?: string; headed?: boolean }) => {
    try {
      const { exitCode } = await runVerify({
        url: opts.url,
        viewport: (opts.viewport ?? "desktop") as "desktop" | "mobile",
        headed: opts.headed,
      });
      process.exit(exitCode);
    } catch (e) {
      console.error(chalk.red("✖ " + (e as Error).message));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// benchmark
// ---------------------------------------------------------------------------
program
  .command("benchmark")
  .description("Evaluate LintCanvas against the built-in known-answer dataset")
  .option("--cases-dir <path>", "Directory containing benchmark case JSON files")
  .option("--sample-app <path>", "Path to the sample React app root")
  .action(async (opts: { casesDir?: string; sampleApp?: string }) => {
    try {
      const { exitCode } = await runBenchmark({
        casesDir: opts.casesDir,
        sampleApp: opts.sampleApp,
      });
      process.exit(exitCode);
    } catch (e) {
      console.error(chalk.red("✖ " + (e as Error).message));
      process.exit(1);
    }
  });

program.parse(process.argv);
