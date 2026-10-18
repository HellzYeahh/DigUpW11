// fluent.js: the backdrop and the person's accent reach the page.
const { test, expect } = require("@playwright/test");
const { openPage } = require("./helpers");

const ACCENT = ["#a6d8ff", "#76b9ed", "#429ce3", "#0078d4", "#005a9e", "#004275", "#002642"];

test("a Windows 11 window gets the backdrop and the accent", async ({ page }) => {
  await openPage(page, "index.html", { system_look: { backdrop: true, accent: ACCENT } });
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-backdrop", "");
  await expect(root).toHaveAttribute("data-platform", "windows");
  const base = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-base").trim());
  expect(base).toBe("#0078d4");
});

test("without a backdrop the page keeps a solid surface", async ({ page }) => {
  await openPage(page, "index.html", { system_look: { backdrop: false, accent: null } });
  await expect(page.locator("html")).not.toHaveAttribute("data-backdrop", "");
  const surface = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--window").trim());
  expect(surface).not.toBe("transparent");
});

test("a new accent from the system reaches an open page", async ({ page }) => {
  await openPage(page, "index.html", { system_look: { backdrop: true, accent: ACCENT } });
  await expect(page.locator("html")).toHaveAttribute("data-accent", "");
  const shades = ["#ffd6e0", "#ffadc2", "#ff7aa0", "#e3008c", "#b0006c", "#8a0055", "#5c0039"];
  await page.evaluate((shades) => window.__mock.emit("system-look", { backdrop: false, accent: shades }), shades);
  await expect(page.locator("html")).not.toHaveAttribute("data-backdrop", "");
  const base = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-base").trim());
  expect(base).toBe("#e3008c");
});
