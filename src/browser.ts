/**
 * LintCanvas – Playwright browser manager
 * Handles browser lifecycle, screenshot capture, and DOM inspection.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import path from "path";
import { writeFileSync } from "fs";
import { logger } from "./logger.js";
import type { Config, ElementInfo } from "./types.js";
import { resolveOutputDir, ensureOutputDirs } from "./config.js";

// CSS properties we collect for each element
const COMPUTED_PROPS = [
  "display",
  "position",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "width",
  "height",
  "max-width",
  "min-width",
  "max-height",
  "min-height",
  "font-size",
  "font-family",
  "font-weight",
  "line-height",
  "color",
  "background-color",
  "border",
  "border-radius",
  "overflow",
  "overflow-x",
  "overflow-y",
  "flex-direction",
  "align-items",
  "justify-content",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "z-index",
  "opacity",
  "visibility",
  "text-overflow",
  "white-space",
  "transform",
  "flex-wrap",
];

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function launchBrowser(headless = true): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    // Disable web security for local dev servers
    bypassCSP: true,
  });
  // Prevent any Node/bundler runtime helpers from failing in browser context
  await context.addInitScript(() => {
    if (typeof (window as any).__name === "undefined") {
      (window as any).__name = (target: any) => target;
    }
  });
  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    close: async () => {
      await page.close();
      await context.close();
      await browser.close();
    },
  };
}

export async function navigateTo(
  page: Page,
  url: string,
  viewport: { width: number; height: number },
  waitForSelector?: string
): Promise<void> {
  await page.setViewportSize(viewport);
  logger.debug(`Navigating to ${url} at ${viewport.width}×${viewport.height}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout: 10_000 });
  }
  // Give animations a moment to settle
  await page.waitForTimeout(500);
}

export async function captureScreenshot(
  page: Page,
  cfg: Config,
  name: "before" | "after" | "reference-check" | string
): Promise<string> {
  ensureOutputDirs(cfg);
  const outPath = path.join(resolveOutputDir(cfg), "screenshots", `${name}.png`);
  await page.screenshot({ path: outPath, fullPage: false, type: "png" });
  logger.debug(`Screenshot saved to ${outPath}`);
  return outPath;
}

export async function inspectElements(
  page: Page,
  selectors?: string[]
): Promise<ElementInfo[]> {
  const results = await page.evaluate(
    ({ selectors, props }: { selectors: string[] | undefined; props: string[] }) => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const helpers = {
        getElements(): Element[] {
          if (selectors && selectors.length > 0) {
            return selectors.flatMap((s) => Array.from(document.querySelectorAll(s)));
          }
          // Default: grab meaningful visible elements
          return Array.from(
            document.querySelectorAll(
              "body > *, main *, header *, nav *, section *, article *, [class], [id]"
            )
          ).slice(0, 120); // cap to avoid huge payloads
        },

        buildSelector(el: Element): string {
          if (el.id) return `#${el.id}`;
          const cls = Array.from(el.classList)
            .slice(0, 2)
            .join(".");
          const tag = el.tagName.toLowerCase();
          return cls ? `${tag}.${cls}` : tag;
        },

        getAccessibleName(el: Element): string | undefined {
          const aria = el.getAttribute("aria-label");
          if (aria) return aria;
          const labelledBy = el.getAttribute("aria-labelledby");
          if (labelledBy) {
            const lbl = document.getElementById(labelledBy);
            if (lbl) return lbl.textContent?.trim() || undefined;
          }
          if (el.tagName === "IMG") return (el as HTMLImageElement).alt || undefined;
          if (el.tagName === "INPUT") {
            const id = el.id;
            if (id) {
              const lbl = document.querySelector(`label[for="${id}"]`);
              if (lbl) return lbl.textContent?.trim() || undefined;
            }
          }
          return undefined;
        },
      };

      const elements = helpers.getElements();
      const results: unknown[] = [];

      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        const computed = window.getComputedStyle(el);
        const styles: Record<string, string> = {};
        for (const prop of props) {
          styles[prop] = computed.getPropertyValue(prop) || "";
        }

        const overflows =
          rect.right > viewportWidth + 2 ||
          rect.bottom > viewportHeight + 2 ||
          rect.left < -2;

        const zStr = computed.getPropertyValue("z-index");
        const zNum = zStr && zStr !== "auto" ? parseInt(zStr, 10) : undefined;

        results.push({
          selector: helpers.buildSelector(el),
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          classes: Array.from(el.classList),
          accessibleName: helpers.getAccessibleName(el),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
          },
          computedStyles: styles,
          isVisible: computed.getPropertyValue("visibility") !== "hidden" &&
            computed.getPropertyValue("display") !== "none" &&
            parseFloat(computed.getPropertyValue("opacity") || "1") > 0,
          overflowsViewport: overflows,
          zIndex: zNum,
          stackingContext: false, // simplified
        });
      }

      return results;
    },
    { selectors, props: COMPUTED_PROPS }
  );

  return results as ElementInfo[];
}

export async function detectOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const overflowing: string[] = [];
    const vw = window.innerWidth;
    const els = Array.from(document.querySelectorAll("*")) as Element[];
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.right > vw + 4) {
        const tag = el.tagName.toLowerCase();
        const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
        const cls = el.classList.length > 0 ? `.${Array.from(el.classList)[0]}` : "";
        overflowing.push(`${tag}${id}${cls} (right edge: ${Math.round(rect.right)}px, viewport: ${vw}px)`);
      }
    }
    return overflowing.slice(0, 20);
  });
}

export async function getPageTitle(page: Page): Promise<string> {
  return page.title();
}

export async function checkDevServer(url: string): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    let ok = false;
    try {
      await page.goto(url, { timeout: 8000, waitUntil: "domcontentloaded" });
      ok = true;
    } catch {
      ok = false;
    } finally {
      await page.close();
      await context.close();
      await browser.close();
    }
    return ok;
  } catch {
    return false;
  }
}

export function saveElementsJson(cfg: Config, elements: ElementInfo[]): string {
  ensureOutputDirs(cfg);
  const outPath = path.join(resolveOutputDir(cfg), "reports", "elements.json");
  writeFileSync(outPath, JSON.stringify(elements, null, 2) + "\n");
  return outPath;
}
