/**
 * LintCanvas – Config loader / writer
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { ConfigSchema, type Config } from "./types.js";
import { logger } from "./logger.js";

export const CONFIG_FILE = "lintcanvas.config.json";
export const OUTPUT_DIR_DEFAULT = ".lintcanvas";

export function resolveOutputDir(cfg: Config): string {
  return path.isAbsolute(cfg.outputDir)
    ? cfg.outputDir
    : path.join(cfg.projectRoot, cfg.outputDir);
}

export function ensureOutputDirs(cfg: Config): void {
  const base = resolveOutputDir(cfg);
  for (const sub of ["reports", "screenshots", "patches"]) {
    const dir = path.join(base, sub);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export function loadConfig(projectRoot?: string): Config {
  const root = projectRoot ?? process.cwd();
  const configPath = path.join(root, CONFIG_FILE);

  if (!existsSync(configPath)) {
    throw new Error(
      `No ${CONFIG_FILE} found in ${root}.\n` +
        `Run \`lintcanvas init\` to create one.`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (e) {
    throw new Error(`Failed to parse ${configPath}: ${(e as Error).message}`);
  }

  const result = ConfigSchema.safeParse({ projectRoot: root, ...(raw as object) });
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid config at ${configPath}:\n${issues}`);
  }

  return result.data;
}

export function saveConfig(cfg: Config): void {
  const configPath = path.join(cfg.projectRoot, CONFIG_FILE);
  // Don't store projectRoot in file – it's derived at load time
  const { projectRoot: _pr, ...rest } = cfg;
  writeFileSync(configPath, JSON.stringify(rest, null, 2) + "\n", "utf-8");
  logger.debug(`Config saved to ${configPath}`);
}

export function loadLatestReport(cfg: Config) {
  const reportPath = path.join(resolveOutputDir(cfg), "reports", "latest.json");
  if (!existsSync(reportPath)) return null;
  try {
    return JSON.parse(readFileSync(reportPath, "utf-8"));
  } catch {
    return null;
  }
}

export function saveReport(cfg: Config, name: string, data: unknown): string {
  ensureOutputDirs(cfg);
  const dir = path.join(resolveOutputDir(cfg), "reports");
  const filePath = path.join(dir, `${name}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  // Also write to latest
  writeFileSync(path.join(dir, "latest.json"), JSON.stringify(data, null, 2) + "\n", "utf-8");
  return filePath;
}
