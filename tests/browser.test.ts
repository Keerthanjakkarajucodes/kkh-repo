/**
 * Regression test verifying Playwright DOM inspection works without __name or runtime errors
 */

import { describe, it, expect, afterAll } from "vitest";
import { launchBrowser, inspectElements, detectOverflow } from "../src/browser.js";
import type { BrowserSession } from "../src/browser.js";

describe("Browser DOM Inspection (Regression for __name runtime error)", () => {
  let session: BrowserSession | null = null;

  afterAll(async () => {
    if (session) {
      await session.close();
    }
  });

  it("inspects DOM elements without __name or ReferenceError", async () => {
    session = await launchBrowser(true);
    await session.page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Test</title></head>
        <body>
          <header class="header">
            <h1 id="main-title">LintCanvas Test</h1>
          </header>
          <main>
            <div class="card" style="width: 200px; height: 100px; padding: 10px;">
              <p>Card Content</p>
            </div>
            <button aria-label="Submit Button">Click</button>
          </main>
        </body>
      </html>
    `);

    const elements = await inspectElements(session.page);
    expect(elements).toBeDefined();
    expect(elements.length).toBeGreaterThan(0);

    const titleEl = elements.find((e) => e.id === "main-title");
    expect(titleEl).toBeDefined();
    expect(titleEl?.tagName).toBe("h1");
    expect(titleEl?.selector).toBe("#main-title");

    const btnEl = elements.find((e) => e.accessibleName === "Submit Button");
    expect(btnEl).toBeDefined();
  });

  it("detects horizontal overflow without errors", async () => {
    if (!session) session = await launchBrowser(true);
    await session.page.setViewportSize({ width: 500, height: 400 });
    await session.page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="overflowing-box" style="width: 1000px; height: 50px;">Wide</div>
        </body>
      </html>
    `);

    const overflowing = await detectOverflow(session.page);
    expect(overflowing).toBeDefined();
    expect(overflowing.length).toBeGreaterThan(0);
    expect(overflowing[0]).toContain("#overflowing-box");
  });
});
