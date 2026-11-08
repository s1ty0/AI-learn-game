import path from "node:path";
import { mkdir } from "node:fs/promises";

process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(".runtime/browsers");
const { chromium, expect } = await import("@playwright/test");
await mkdir(".runtime/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const calls = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/api/v1/")) calls.push(request.url()); });
  const loaded = page.waitForResponse(response => response.url().endsWith("/api/v1/adventure") && response.status() === 200);
  const response = await page.goto("http://127.0.0.1:3000");
  expect(response.status()).toBe(200);
  const progress = await (await loaded).json();
  if (progress.stage === 3) {
    const chapter = await (await page.request.get("http://127.0.0.1:3000/api/v1/chapter")).json();
    const next = chapter.nodes.find(node => node.id === chapter.next_node);
    await expect(page.locator(".beacon-entry")).toHaveAttribute("aria-label", new RegExp(next.title));
  }
  await expect(page.locator(".beacon-entry")).toBeEnabled();
  await page.screenshot({ path: ".runtime/screenshots/adventure-live.png", animations: "disabled" });
  await page.locator(".beacon-entry").click();
  await expect(page.locator(".island-room").getByRole("slider").first()).toBeVisible();
  await page.screenshot({ path: ".runtime/screenshots/adventure-live-room.png", animations: "disabled", fullPage: true });
  expect(calls.some(url => url.includes("/content") || url.includes("/learner-graph"))).toBe(false);
  expect(errors).toEqual([]);
  console.log("Live PostgreSQL-backed entrance and room verified; no progress changed, no full catalog requested.");
} finally {
  await browser.close();
}
