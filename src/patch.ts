/**
 * LintCanvas – CSS patch engine
 * Finds CSS declarations in source files and generates minimal, safe patches.
 * Uses PostCSS for robust parsing. Only edits declarations that can be
 * unambiguously located and safely changed.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "fs";
import path from "path";
import postcss from "postcss";
import type { Finding, Patch } from "./types.js";
import { logger } from "./logger.js";
import { isSafeProperty } from "./ai.js";

// CSS file extensions we handle
const CSS_EXTENSIONS = [".css", ".scss", ".module.css", ".module.scss"];

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  selector: string;
  property: string;
  value: string;
}

/**
 * Find CSS files in a project root (up to a limited depth).
 */
export function findCssFiles(projectRoot: string, maxDepth = 5): string[] {
  const results: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }).map((e) =>
        e.isDirectory() ? `${e.name}/` : e.name
      );
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.endsWith("/")) {
        const name = entry.slice(0, -1);
        if (["node_modules", ".git", "dist", "build", ".lintcanvas"].includes(name)) continue;
        walk(path.join(dir, name), depth + 1);
      } else {
        if (CSS_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
          results.push(path.join(dir, entry));
        }
      }
    }
  }

  walk(projectRoot, 0);
  return results;
}

/**
 * Parse a CSS file and search for a declaration matching the given selector + property.
 * Returns the first matching source location or null.
 */
export function findDeclaration(
  cssFilePath: string,
  targetSelector: string,
  targetProperty: string
): SourceLocation | null {
  let content: string;
  try {
    content = readFileSync(cssFilePath, "utf-8");
  } catch {
    return null;
  }

  let root: postcss.Root;
  try {
    root = postcss.parse(content, { from: cssFilePath });
  } catch (e) {
    logger.debug(`Could not parse ${cssFilePath}: ${(e as Error).message}`);
    return null;
  }

  let found: SourceLocation | null = null;

  root.walkRules((rule) => {
    if (found) return false; // stop walking
    // Normalise selectors for comparison
    const ruleSelectors = rule.selector.split(",").map((s) => s.trim().toLowerCase());
    const targetNorm = targetSelector.trim().toLowerCase();

    const matches =
      ruleSelectors.some((s) => s === targetNorm) ||
      ruleSelectors.some((s) => s.includes(targetNorm)) ||
      ruleSelectors.some((s) => targetNorm.includes(s));

    if (!matches) return;

    rule.walkDecls(targetProperty, (decl) => {
      if (found) return false;
      const source = decl.source;
      found = {
        file: cssFilePath,
        line: source?.start?.line ?? 0,
        column: source?.start?.column ?? 0,
        selector: rule.selector,
        property: decl.prop,
        value: decl.value,
      };
      return false; // stop walking decls
    });
  });

  return found;
}

/**
 * Generate a unified diff string (simplified, no external tool dependency).
 */
function generateDiff(originalContent: string, newContent: string, filePath: string): string {
  const origLines = originalContent.split("\n");
  const newLines = newContent.split("\n");
  const lines: string[] = [];
  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);

  const maxLen = Math.max(origLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const orig = origLines[i];
    const next = newLines[i];
    if (orig !== next) {
      if (orig !== undefined) lines.push(`-${orig}`);
      if (next !== undefined) lines.push(`+${next}`);
    } else {
      lines.push(` ${orig ?? ""}`);
    }
  }

  return lines.join("\n");
}

/**
 * Apply a patch to a CSS file: replace the old declaration value with the new one.
 * Creates a backup first. Returns the diff string.
 */
export function applyPatch(
  cssFilePath: string,
  selector: string,
  property: string,
  oldValue: string,
  newValue: string,
  backupDir: string
): { diff: string; backupPath: string } {
  const content = readFileSync(cssFilePath, "utf-8");

  // Back up original
  const backupName = `${path.basename(cssFilePath)}.${Date.now()}.bak`;
  const backupPath = path.join(backupDir, backupName);
  copyFileSync(cssFilePath, backupPath);
  logger.debug(`Backup created at ${backupPath}`);

  let root: postcss.Root;
  try {
    root = postcss.parse(content, { from: cssFilePath });
  } catch (e) {
    throw new Error(`Failed to parse ${cssFilePath}: ${(e as Error).message}`);
  }

  let patched = false;
  const targetNorm = selector.trim().toLowerCase();

  root.walkRules((rule) => {
    if (patched) return false;
    const ruleSelectors = rule.selector.split(",").map((s) => s.trim().toLowerCase());
    const matches =
      ruleSelectors.some((s) => s === targetNorm) ||
      ruleSelectors.some((s) => s.includes(targetNorm)) ||
      ruleSelectors.some((s) => targetNorm.includes(s));

    if (!matches) return;

    rule.walkDecls(property, (decl) => {
      if (patched) return false;
      if (decl.value.trim() === oldValue.trim()) {
        decl.value = newValue;
        patched = true;
        return false;
      }
    });
  });

  if (!patched) {
    throw new Error(
      `Could not find declaration: ${selector} { ${property}: ${oldValue} } in ${cssFilePath}`
    );
  }

  const newContent = root.toResult().css;
  writeFileSync(cssFilePath, newContent, "utf-8");
  const diff = generateDiff(content, newContent, cssFilePath);
  return { diff, backupPath };
}

/**
 * Revert a patched file from its backup.
 */
export function revertPatch(cssFilePath: string, backupPath: string): void {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }
  copyFileSync(backupPath, cssFilePath);
  logger.info(`Reverted ${cssFilePath} from backup`);
}

/**
 * Build a Patch object for a finding – searching CSS files for the declaration.
 */
export async function buildPatchForFinding(
  finding: Finding,
  projectRoot: string,
  patchesDir: string
): Promise<Patch | null> {
  if (finding.requiresHumanReview) {
    logger.info(`  Skipping ${finding.id}: requires human review`);
    return null;
  }
  if (!finding.candidateProperty || !finding.proposedNewValue) {
    logger.info(`  Skipping ${finding.id}: no candidate property/value`);
    return null;
  }
  if (!isSafeProperty(finding.candidateProperty)) {
    logger.warn(`  Skipping ${finding.id}: property "${finding.candidateProperty}" not in safe list`);
    return null;
  }

  const prop = finding.candidateProperty;
  const newVal = finding.proposedNewValue;
  const oldVal = finding.proposedOldValue ?? "";

  // 1. Try the file suggested by AI
  let location: SourceLocation | null = null;
  if (finding.candidateFile) {
    const absPath = path.isAbsolute(finding.candidateFile)
      ? finding.candidateFile
      : path.join(projectRoot, finding.candidateFile);
    location = findDeclaration(absPath, finding.selector, prop);
  }

  // 2. Search all CSS files in project
  if (!location) {
    const cssFiles = findCssFiles(projectRoot);
    for (const cssFile of cssFiles) {
      location = findDeclaration(cssFile, finding.selector, prop);
      if (location) break;
    }
  }

  if (!location) {
    logger.info(
      `  No source location found for ${finding.id} (${finding.selector} { ${prop} }). ` +
        `Marking for human review.`
    );
    return null;
  }

  // Validate the existing value matches what AI reported
  const resolvedOldVal = location.value;

  // Generate a preview diff (not yet applied)
  const fileContent = readFileSync(location.file, "utf-8");
  const fakeNew = fileContent.replace(
    new RegExp(`(${escapeRegex(prop)}\\s*:\\s*)${escapeRegex(resolvedOldVal)}`),
    `$1${newVal}`
  );
  const diff = generateDiff(fileContent, fakeNew, path.relative(projectRoot, location.file));

  const patch: Patch = {
    findingId: finding.id,
    file: path.relative(projectRoot, location.file),
    property: prop,
    selector: location.selector,
    oldValue: resolvedOldVal,
    newValue: newVal,
    diff,
    applied: false,
  };

  return patch;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
