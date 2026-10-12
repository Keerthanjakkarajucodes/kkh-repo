/**
 * Unit tests for the CSS patch engine
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import path from "path";
import { findDeclaration, findCssFiles, applyPatch, revertPatch } from "../src/patch.js";

const TMP_DIR = path.join(process.cwd(), "test-tmp-patch");

const SAMPLE_CSS = `
/* Sample CSS */
.hero {
  margin: 0;
  padding: 24px;
  background-color: #fff;
}

.hero h1 {
  font-size: 32px;
  color: #333;
}

.nav {
  display: flex;
  gap: 16px;
  padding: 12px 24px;
}

.card {
  max-width: 400px;
  margin: 0 auto;
  padding: 16px;
}
`.trim();

beforeAll(() => {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(path.join(TMP_DIR, "sample.css"), SAMPLE_CSS, "utf-8");
  // Create a subdirectory with another CSS file
  mkdirSync(path.join(TMP_DIR, "components"), { recursive: true });
  writeFileSync(
    path.join(TMP_DIR, "components", "button.css"),
    ".btn { padding: 8px 16px; font-size: 14px; }",
    "utf-8"
  );
});

afterAll(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("findDeclaration", () => {
  const cssPath = path.join(TMP_DIR, "sample.css");

  it("finds a simple property in a rule", () => {
    const loc = findDeclaration(cssPath, ".hero", "padding");
    expect(loc).not.toBeNull();
    expect(loc!.property).toBe("padding");
    expect(loc!.value).toBe("24px");
  });

  it("finds a property in a nested selector", () => {
    const loc = findDeclaration(cssPath, ".hero h1", "font-size");
    expect(loc).not.toBeNull();
    expect(loc!.value).toBe("32px");
  });

  it("finds a property in .nav", () => {
    const loc = findDeclaration(cssPath, ".nav", "gap");
    expect(loc).not.toBeNull();
    expect(loc!.value).toBe("16px");
  });

  it("returns null for missing property", () => {
    const loc = findDeclaration(cssPath, ".hero", "nonexistent-property");
    expect(loc).toBeNull();
  });

  it("returns null for missing selector", () => {
    const loc = findDeclaration(cssPath, ".nonexistent", "padding");
    expect(loc).toBeNull();
  });

  it("returns null for missing file", () => {
    const loc = findDeclaration("/nonexistent/file.css", ".hero", "padding");
    expect(loc).toBeNull();
  });

  it("finds max-width in .card", () => {
    const loc = findDeclaration(cssPath, ".card", "max-width");
    expect(loc).not.toBeNull();
    expect(loc!.value).toBe("400px");
  });
});

describe("findCssFiles", () => {
  it("finds CSS files in directory tree", () => {
    const files = findCssFiles(TMP_DIR);
    expect(files.some((f) => f.endsWith("sample.css"))).toBe(true);
    expect(files.some((f) => f.endsWith("button.css"))).toBe(true);
  });

  it("excludes node_modules", () => {
    const files = findCssFiles(TMP_DIR);
    expect(files.every((f) => !f.includes("node_modules"))).toBe(true);
  });
});

describe("applyPatch and revertPatch", () => {
  it("applies a CSS value change and creates a backup", () => {
    // Use a copy of sample.css to avoid mutating the original
    const workFile = path.join(TMP_DIR, "work.css");
    writeFileSync(workFile, SAMPLE_CSS, "utf-8");
    const backupDir = path.join(TMP_DIR, "backups");
    mkdirSync(backupDir, { recursive: true });

    const { diff, backupPath } = applyPatch(
      workFile,
      ".hero",
      "padding",
      "24px",
      "32px",
      backupDir
    );

    const newContent = readFileSync(workFile, "utf-8");
    expect(newContent).toContain("padding: 32px");
    expect(newContent).not.toContain("padding: 24px");
    expect(existsSync(backupPath)).toBe(true);
    expect(diff).toContain("-  padding: 24px");
    expect(diff).toContain("+  padding: 32px");
  });

  it("reverts a patch from backup", () => {
    const workFile = path.join(TMP_DIR, "revert-work.css");
    writeFileSync(workFile, SAMPLE_CSS, "utf-8");
    const backupDir = path.join(TMP_DIR, "backups");

    const { backupPath } = applyPatch(workFile, ".hero", "padding", "24px", "99px", backupDir);
    expect(readFileSync(workFile, "utf-8")).toContain("padding: 99px");

    revertPatch(workFile, backupPath);
    expect(readFileSync(workFile, "utf-8")).toContain("padding: 24px");
  });

  it("throws if declaration not found", () => {
    const workFile = path.join(TMP_DIR, "notfound-work.css");
    writeFileSync(workFile, SAMPLE_CSS, "utf-8");
    const backupDir = path.join(TMP_DIR, "backups");

    expect(() =>
      applyPatch(workFile, ".hero", "padding", "999px", "0px", backupDir)
    ).toThrow();
  });
});
