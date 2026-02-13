#!/usr/bin/env node
/**
 * Browser test for embedding - loads test-embed.html, clicks Run, checks result.
 * Run: BASE_URL=http://localhost:5173 npm run test:embed-browser
 * Skip: SKIP_BROWSER_TEST=1 npm run test:embed-browser
 *
 * Note: ONNX "Can't create session" may occur in Playwright's automated browser.
 * Manual test at /test-embed.html in a real browser often works.
 */
import { chromium, firefox } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const USE_FIREFOX = process.env.USE_FIREFOX === "1";
const SKIP = process.env.SKIP_BROWSER_TEST === "1";

async function main() {
  if (SKIP) {
    console.log("Skipping browser embed test (SKIP_BROWSER_TEST=1)");
    return;
  }
  const browserType = USE_FIREFOX ? firefox : chromium;
  const headless = process.env.HEADED !== "1";
  const launchOptions = { headless };
  if (browserType === chromium) {
    launchOptions.args = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=swiftshader",
      "--disable-features=IsolateOrigins,site-per-process",
    ];
  }
  const browser = await browserType.launch(launchOptions);
  const page = await browser.newPage();
  const consoleLogs = [];
  try {
    await page.goto(BASE + "/test-embed.html", { waitUntil: "networkidle" });
    await page.click("#run");
    await page.waitForFunction(
      () => {
        const t = document.getElementById("out")?.textContent || "";
        return t.includes("✓") || t.includes("✗");
      },
      { timeout: 90000 }
    );
    const text = await page.textContent("#out");
    if (text?.includes("✓")) {
      console.log("✓ Browser embed test passed");
      console.log(text);
    } else {
      console.error("✗ Browser embed test failed");
      console.error(text);
      console.error("Tip: Run manually at", BASE + "/test-embed.html in a real browser.");
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
