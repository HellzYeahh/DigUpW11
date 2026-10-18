// Opening a shell page under test: the stand-in for Tauri first, with the commands' answers, then the page.
const path = require("path");
const fs = require("fs");

const UI = path.resolve(__dirname, "../../ui");

async function openPage(page, file, responses = {}, { platform = "Win32", setup } = {}) {
  await page.addInitScript(({ responses, platform }) => {
    window.__mock = { platform, responses: {} };
    for (const [command, value] of Object.entries(responses)) {
      window.__mock.responses[command] = typeof value === "string" && value.startsWith("fn:")
        ? new Function("args", value.slice(3)) : value;
    }
  }, { responses: serialize(responses), platform });
  await page.addInitScript({ path: path.join(__dirname, "../mock-tauri.js") });
  if (setup) await page.addInitScript(setup);
  const [name, query] = file.split("?");
  await page.goto("file://" + path.join(UI, name) + (query ? "?" + query : ""));
}

// Functions can't cross into the page: they go as their bodies ("fn:" + body, with `args`).
function serialize(responses) {
  const out = {};
  for (const [command, value] of Object.entries(responses)) {
    out[command] = typeof value === "function" ? "fn:return (" + value.toString() + ")(args)" : value;
  }
  return out;
}

// A screenshot for review, when SHOTS is set: shots/<name>-<light|dark>.png.
async function shot(page, testInfo, name) {
  if (!process.env.SHOTS) return;
  const dir = path.resolve(__dirname, "../shots");
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}-${testInfo.project.name}.png`) });
}

const calls = (page, command) => page.evaluate((command) => window.__mock.callsTo(command), command);

module.exports = { openPage, shot, calls };
