/**
 * LintCanvas – `lintcanvas init` command
 */

import { existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { execSync } from "child_process";
import { logger } from "../logger.js";
import { CONFIG_FILE, OUTPUT_DIR_DEFAULT } from "../config.js";
import type { Config } from "../types.js";

export interface InitOptions {
  force?: boolean;
}

function detectPackageScripts(root: string): { dev?: string; build?: string; port?: number } {
  const pkgPath = path.join(root, "package.json");
  if (!existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
      name?: string;
    };
    const scripts = pkg.scripts ?? {};
    const devCmd = scripts["dev"] ?? scripts["start"] ?? scripts["serve"] ?? undefined;
    let port: number | undefined;
    if (devCmd?.includes("5173")) port = 5173;
    else if (devCmd?.includes("3000")) port = 3000;
    else if (devCmd?.includes("3001")) port = 3001;
    else if (devCmd?.includes("8080")) port = 8080;
    return { dev: devCmd ? "npm run dev" : undefined, port };
  } catch {
    return {};
  }
}

function gitignoreHasLintcanvas(root: string): boolean {
  const gi = path.join(root, ".gitignore");
  if (!existsSync(gi)) return false;
  return readFileSync(gi, "utf-8").includes(".lintcanvas");
}

function appendGitignore(root: string): void {
  const gi = path.join(root, ".gitignore");
  const entry = "\n# LintCanvas output\n.lintcanvas/\n";
  if (existsSync(gi)) {
    const content = readFileSync(gi, "utf-8");
    if (!content.includes(".lintcanvas")) {
      writeFileSync(gi, content + entry, "utf-8");
      logger.info(`Added .lintcanvas/ to .gitignore`);
    }
  } else {
    writeFileSync(gi, entry.trimStart(), "utf-8");
    logger.info(`Created .gitignore with .lintcanvas/ entry`);
  }
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const root = process.cwd();
  const configPath = path.join(root, CONFIG_FILE);

  logger.header("LintCanvas — Init");

  if (existsSync(configPath) && !options.force) {
    logger.warn(
      `Config already exists at ${configPath}.\n` +
        `Use --force to overwrite, or edit the file directly.`
    );
    return;
  }

  logger.info("Detecting project structure...");

  const { dev: devCommand, port: devPort } = detectPackageScripts(root);
  if (devCommand) {
    logger.success(`Found dev command: ${devCommand}`);
  } else {
    logger.warn("Could not detect a dev command. You will need to set devCommand manually.");
  }

  const targetUrl =
    devPort
      ? `http://localhost:${devPort}`
      : devCommand
        ? "http://localhost:3000"
        : "";

  const defaultConfig: Omit<Config, "projectRoot"> = {
    version: "1",
    targetUrl: targetUrl || undefined,
    devCommand: devCommand || "npm run dev",
    devPort: devPort,
    referenceDesktop: undefined,
    referenceMobile: undefined,
    viewport: {
      desktop: { width: 1280, height: 800 },
      mobile: { width: 375, height: 812 },
    },
    designRules: [],
    gemmaModel: process.env["GEMMA_MODEL"] ?? "gemma-4-31b-it",
    outputDir: OUTPUT_DIR_DEFAULT,
    ci: {
      failOnWarnings: false,
      maxMismatchPercent: 5,
    },
  };

  writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + "\n", "utf-8");
  logger.success(`Created ${CONFIG_FILE}`);

  appendGitignore(root);

  // Check if Playwright browsers are installed
  logger.info("Checking Playwright browser installation...");
  try {
    execSync("npx playwright --version", { stdio: "pipe" });
    logger.success("Playwright found");
  } catch {
    logger.warn(
      "Playwright browsers may not be installed.\n" +
        "Run: npx playwright install chromium\n" +
        "  (only Chromium is required for LintCanvas)"
    );
  }

  // Check API key
  if (!process.env["GEMINI_API_KEY"]) {
    logger.warn(
      "GEMINI_API_KEY is not set.\n" +
        "  1. Get a key at https://aistudio.google.com/\n" +
        `  2. Copy .env.example to .env and paste your key\n` +
        "  Screenshot comparison will work without a key, but AI analysis requires one."
    );
  } else {
    logger.success("GEMINI_API_KEY found in environment");
  }

  logger.divider();
  logger.plain("");
  logger.plain("Next steps:");
  logger.plain(`  1. Edit ${CONFIG_FILE}:`);
  logger.plain(`       - Set "targetUrl" to your dev server URL`);
  logger.plain(`       - Set "referenceDesktop" to your Figma export PNG path`);
  logger.plain(`       - Set "referenceMobile" for mobile comparison (optional)`);
  logger.plain(`  2. Start your dev server`);
  logger.plain(`  3. Run: lintcanvas check`);
  logger.plain("");
}
