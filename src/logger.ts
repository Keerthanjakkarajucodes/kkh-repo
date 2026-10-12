/**
 * LintCanvas – Logger
 * Consistent, coloured console output throughout the CLI.
 */

import chalk from "chalk";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const levelRank: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return levelRank[level] <= levelRank[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => {
    if (shouldLog("debug")) {
      console.debug(chalk.gray(`[DEBUG ${timestamp()}]`), msg, ...args);
    }
  },

  info: (msg: string, ...args: unknown[]) => {
    if (shouldLog("info")) {
      console.info(chalk.blue("ℹ"), msg, ...args);
    }
  },

  success: (msg: string, ...args: unknown[]) => {
    if (shouldLog("info")) {
      console.info(chalk.green("✔"), chalk.green(msg), ...args);
    }
  },

  warn: (msg: string, ...args: unknown[]) => {
    if (shouldLog("warn")) {
      console.warn(chalk.yellow("⚠"), chalk.yellow(msg), ...args);
    }
  },

  error: (msg: string, ...args: unknown[]) => {
    if (shouldLog("error")) {
      console.error(chalk.red("✖"), chalk.red(msg), ...args);
    }
  },

  step: (step: number, total: number, msg: string) => {
    if (shouldLog("info")) {
      console.info(chalk.cyan(`[${step}/${total}]`), msg);
    }
  },

  header: (title: string) => {
    if (shouldLog("info")) {
      console.info("");
      console.info(chalk.bold.cyan("━".repeat(60)));
      console.info(chalk.bold.cyan(`  ${title}`));
      console.info(chalk.bold.cyan("━".repeat(60)));
    }
  },

  divider: () => {
    if (shouldLog("info")) {
      console.info(chalk.gray("─".repeat(60)));
    }
  },

  finding: (id: string, severity: string, msg: string) => {
    if (!shouldLog("info")) return;
    const icon =
      severity === "error"
        ? chalk.red("●")
        : severity === "warning"
          ? chalk.yellow("●")
          : chalk.blue("●");
    console.info(icon, chalk.bold(`[${id}]`), msg);
  },

  plain: (msg: string) => {
    if (shouldLog("info")) {
      console.info(msg);
    }
  },
};
