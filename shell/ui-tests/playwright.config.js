// The shell's pages, loaded from shell/ui as files, in Chromium: WebView2, which shows them on Windows, is Chromium too.
// A stand-in for Tauri (mock-tauri.js) answers their commands. CHROMIUM picks a browser already on the machine.
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  timeout: 20_000,
  reporter: [["list"]],
  use: {
    launchOptions: process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
    // Windows' default scaling, at its usual DPI.
    deviceScaleFactor: 1,
  },
  projects: [
    { name: "light", use: { colorScheme: "light" } },
    { name: "dark", use: { colorScheme: "dark" } },
  ],
});
