// The search panel (index.html): its keys, clicks, states and what it asks of the shell, as the Mac app's panel
// (SearchPanel.swift, SearchPanelView.swift) behaves, in Windows 11's look.
const { test, expect } = require("@playwright/test");
const { openPage, shot, calls } = require("./helpers");
const { HITS, CODE_HITS, STATE, helperScript } = require("./search-fixtures");

const ACCENT = ["#a6d8ff", "#76b9ed", "#429ce3", "#0078d4", "#005a9e", "#004275", "#002642"];
const [SCREENSHOT, IMAGE, PDF, DOC, VIDEO, AUDIO] = HITS;

/// The panel with the helper's stand-in; `backdrop` puts it over Acrylic (drawn here as a tinted wash, which is what
/// shows through a transparent page).
async function openPanel(page, { state = {}, helper = {}, backdrop = false, responses = {}, height = 480 } = {}) {
  await page.setViewportSize({ width: 780, height });
  await openPage(page, "index.html", {
    system_look: { backdrop, accent: ACCENT },
    app_state: { ...STATE, ...state },
    opens_at_moment: true,
    ...responses,
  }, { setup: { content: helperScript(helper) } });
  if (backdrop) {
    await page.addStyleTag({ content: "html { background: linear-gradient(135deg, #dfe6ee, #f1e9e2); } "
      + "@media (prefers-color-scheme: dark) { html { background: linear-gradient(135deg, #1d232b, #2a2420); } }" });
  }
  await expect(page.locator("#query")).toBeVisible();
}

async function search(page, text) {
  await page.locator("#query").fill(text);
  await expect(page.locator("#summary")).toHaveText(/results?/);
}

const selectedName = (page) => page.locator(".row.selected .name").getAttribute("title");
const asked = (page, op) => page.evaluate((op) => window.__asked.filter((request) => request.op === op), op);

test.describe("results", () => {
  test("group by kind, follow the top hit, and preview each kind", async ({ page }, testInfo) => {
    await openPanel(page);
    await search(page, "receipt");
    await expect(page.locator(".group-title")).toHaveText(["Screenshots", "Images", "Documents", "Video", "Audio"]);
    expect(await selectedName(page)).toBe("Screenshot 2026-10-07 142233 payment error.png");
    await expect(page.locator(".preview .reason")).toHaveText("Matches what's on screen");
    await expect(page.locator(".preview .open")).toHaveText("Open");
    await expect(page.locator("#summary")).toHaveText("6 results");
    await shot(page, testInfo, "panel-results-screenshot");
    const kinds = ["image", "pdf", "doc", "video", "audio"];
    for (const kind of kinds) {
      await page.keyboard.press("ArrowDown");
      if (kind === "doc") await expect(page.locator(".preview .passage mark").first()).toHaveText("receipt");
      if (kind === "audio") await expect(page.locator(".preview .audio-moment .span")).toHaveText("0:25 – 0:55 of 3:12");
      if (kind === "video") await expect(page.locator(".preview .marks .moment-bar")).toBeVisible();
      await page.waitForTimeout(150);
      await shot(page, testInfo, `panel-results-${kind}`);
    }
  });

  test("pictures come from the helper's renders, never the file itself", async ({ page }) => {
    await openPanel(page);
    await search(page, "receipt");
    await page.keyboard.press("ArrowDown");   // the photo: 4032 × 3024
    const image = page.locator(".preview .frame img");
    await expect(image).toHaveAttribute("src", /digup-ui-fixtures/);
    const renders = await asked(page, "render");
    expect(renders.some((request) => request.path === IMAGE.path && request.pixels === 410)).toBe(true);
    expect(await page.locator("img").evaluateAll((images) => images.map((image) => image.src)))
      .not.toContain(expect.stringContaining("beach dog.jpg"));
  });

  test("the arrows move the selection without redrawing the list", async ({ page }) => {
    await openPanel(page);
    await search(page, "receipt");
    await page.evaluate(() => { document.querySelector(".row").dataset.kept = "yes"; });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await selectedName(page)).toBe("hardware store receipt.pdf");
    await expect(page.locator(".row").first()).toHaveAttribute("data-kept", "yes");
    await page.keyboard.press("ArrowUp");
    expect(await selectedName(page)).toBe("beach dog.jpg");
    await expect(page.locator(".preview .facts .title")).toHaveText(/beach dog\.jpg/);
    await expect(page.locator(".row.selected")).toHaveAttribute("aria-selected", "true");
  });

  test("weaker matches fold under a row Enter unfolds", async ({ page }) => {
    await openPanel(page, { helper: { strong: 4 } });
    await search(page, "receipt");
    await expect(page.locator("#summary")).toHaveText("4 results · 2 weaker");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await expect(page.locator(".weaker")).toHaveClass(/selected/);
    await expect(page.locator(".message strong")).toHaveText("2 weaker matches");
    await page.keyboard.press("Enter");
    await expect(page.locator(".row.weaker-row")).toHaveCount(2);
    await expect(page.locator(".row.weaker-row").first()).toHaveCSS("opacity", "0.85");
    expect(await calls(page, "open_path")).toEqual([]);
  });

  test("Show all opens the kind in the window", async ({ page }) => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...SCREENSHOT, path: SCREENSHOT.path.replace(".png", ` ${i}.png`) }));
    await openPanel(page, { helper: { hits: many } });
    await search(page, "error");
    await page.locator(".more").click();
    expect(await calls(page, "open_window")).toEqual([{ query: "error", kind: "screenshots" }]);
  });
});

test.describe("keys", () => {
  test("Enter opens at the page or moment; Ctrl+Enter shows it in Explorer", async ({ page }) => {
    await openPanel(page);
    await search(page, "receipt");
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+Enter");
    expect(await calls(page, "open_path")).toEqual([
      { path: SCREENSHOT.path }, { path: PDF.path, page: 3 }, { path: VIDEO.path, seconds: 6 }]);
    expect(await calls(page, "reveal")).toEqual([{ path: VIDEO.path }]);
  });

  test("Enter on code opens it in the editor at its line, and says so", async ({ page }) => {
    await openPanel(page);
    await search(page, "code: retry");
    await expect(page.locator("#summary")).toHaveText("2 results in your code");
    await expect(page.locator(".preview .open")).toHaveText("Open in Visual Studio Code");
    await expect(page.locator("#keys")).toHaveText("↩ Open in Visual Studio Code at line 14   Ctrl+↩ Show in Explorer   ␣ Preview   Ctrl+C Copy");
    await expect(page.locator(".preview .code-lines .line.focus")).toContainText("export async function retry");
    await expect(page.locator(".preview .code-lines .number").first()).toHaveText("12");
    await page.keyboard.press("Enter");
    expect(await calls(page, "open_code")).toEqual([{ path: CODE_HITS[0].path, line: 14 }]);
  });

  test("the Open button and the keys say where it opens", async ({ page }) => {
    await openPanel(page);
    await search(page, "receipt");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await expect(page.locator(".preview .open")).toHaveText("Open at 0:06");
    await expect(page.locator("#keys")).toHaveText("↩ Open at 0:06   Ctrl+↩ Show in Explorer   ␣ Preview at 0:06   Ctrl+C Copy");
    // Asked once per extension of the recordings found: the video's and the audio's.
    expect(await calls(page, "opens_at_moment")).toEqual([{ path: VIDEO.path }, { path: AUDIO.path }]);
    await page.locator(".preview .reveal").click();
    expect(await calls(page, "reveal")).toEqual([{ path: VIDEO.path }]);
    await page.locator(".preview .facts .folder").click();
    expect((await calls(page, "reveal")).length).toBe(2);
  });

  test("an app that can't be told the moment just opens", async ({ page }) => {
    await openPanel(page, { responses: { opens_at_moment: false } });
    await search(page, "receipt");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await expect(page.locator(".preview .open")).toHaveText("Open");
    await expect(page.locator("#keys")).toHaveText("↩ Open   Ctrl+↩ Show in Explorer   ␣ Preview at 0:06   Ctrl+C Copy");
  });

  test("Space types until a result is picked, then shows the big preview", async ({ page }, testInfo) => {
    await openPanel(page, { height: 640 });
    await search(page, "receipt");
    await page.keyboard.press("Space");
    await expect(page.locator("#query")).toHaveValue("receipt ");
    await expect(page.locator(".big")).toBeHidden();
    await expect(page.locator("#summary")).toHaveText("6 results");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect(page.locator(".big .sheet")).toBeVisible();
    await expect(page.locator(".big .name")).toHaveText("beach dog.jpg");
    await expect(page.locator(".big .f-button.accent")).toHaveText("Open");
    expect((await calls(page, "panel_height")).at(-1)).toEqual({ height: 640 });
    // The arrows go on under it.
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".big .name")).toHaveText("hardware store receipt.pdf");
    await expect(page.locator(".big .place")).toHaveText("p. 3");
    await expect(page.locator(".big img")).toHaveAttribute("src", /digup-ui-fixtures/);
    await page.waitForTimeout(250);
    await shot(page, testInfo, "panel-big");
    await page.keyboard.press("Space");
    await expect(page.locator(".big")).toBeHidden();
    expect((await calls(page, "panel_height")).at(-1)).toEqual({ height: 480 });
  });

  test("Ctrl+Y shows the big preview without arrowing; Esc puts it away and keeps the panel", async ({ page }) => {
    await openPanel(page);
    await search(page, "receipt");
    await page.keyboard.press("Control+y");
    await expect(page.locator(".big .sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".big")).toBeHidden();
    await page.waitForTimeout(200);
    expect(await calls(page, "hide_panel")).toEqual([]);
  });

  test("Ctrl+C copies the file and says so, unless the query's text is selected", async ({ page }) => {
    await openPanel(page);
    await search(page, "receipt");
    // The panel opens with the last query selected: Ctrl+C copies that text.
    await page.locator("#query").selectText();
    await page.keyboard.press("Control+c");
    expect(await calls(page, "copy_file")).toEqual([]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Control+c");
    expect(await calls(page, "copy_file")).toEqual([{ path: IMAGE.path }]);
    await expect(page.locator("#summary")).toHaveText("Copied beach dog.jpg");
    await expect(page.locator("#summary")).toHaveText("6 results", { timeout: 3000 });
  });

  test("Ctrl+O, Ctrl+, and Ctrl+N", async ({ page }) => {
    await openPanel(page);
    await search(page, "receipt");
    await page.keyboard.press("Control+o");
    await page.keyboard.press("Control+,");
    await page.keyboard.press("Control+n");
    expect(await calls(page, "open_window")).toEqual([{ query: "receipt", kind: null }, { query: "", kind: null }]);
    expect(await calls(page, "open_settings")).toEqual([{}]);
  });

  test("the shell hiding the panel fades it without asking to hide again", async ({ page }) => {
    await openPanel(page);
    await search(page, "receipt");
    await page.evaluate(() => window.__mock.emit("panel-hiding"));
    await expect(page.locator("#panel")).toHaveClass(/hiding/);
    await page.waitForTimeout(300);
    expect(await calls(page, "hide_panel")).toEqual([]);
    await page.evaluate(() => window.__mock.emit("panel-shown"));
    await expect(page.locator("#panel")).not.toHaveClass(/hiding/);
  });

  test("Esc fades the panel out, then the shell hides it; shown again it fades in", async ({ page }) => {
    await openPanel(page);
    await search(page, "receipt");
    await page.keyboard.press("Escape");
    await expect(page.locator("#panel")).toHaveClass(/hiding/);
    expect(await calls(page, "hide_panel")).toEqual([]);
    await expect.poll(() => calls(page, "hide_panel")).toHaveLength(1);
    await page.evaluate(() => window.__mock.emit("panel-shown"));
    await expect(page.locator("#panel")).not.toHaveClass(/hiding|entering/);
    await expect(page.locator("#panel")).toHaveCSS("opacity", "1");
    // Like Spotlight: the last query, selected.
    expect(await page.evaluate(() => [document.activeElement.id, document.activeElement.selectionStart,
                                      document.activeElement.selectionEnd])).toEqual(["query", 0, 7]);
  });

  test("a click on a row keeps the cursor in the field; a click back in the field makes Space type", async ({ page }) => {
    await openPanel(page);
    await search(page, "receipt");
    await page.locator(".row").nth(2).click();
    expect(await selectedName(page)).toBe("hardware store receipt.pdf");
    expect(await page.evaluate(() => document.activeElement.id)).toBe("query");
    await page.keyboard.type("s");
    await expect(page.locator("#query")).toHaveValue("receipts");
    await search(page, "receipt");
    await page.locator(".row").nth(1).click();
    await page.locator("#query").click();
    await page.keyboard.press("Space");
    await expect(page.locator("#query")).toHaveValue("receipt ");
  });

  test("a double-click opens", async ({ page }) => {
    await openPanel(page);
    await search(page, "receipt");
    await page.locator(".row").nth(1).dblclick();
    expect(await calls(page, "open_path")).toEqual([{ path: IMAGE.path }]);
  });
});

test.describe("menu and drag", () => {
  test("right-click offers Open, Show in Explorer, Copy and Copy Path", async ({ page }, testInfo) => {
    await openPanel(page);
    await search(page, "receipt");
    await page.locator(".row").nth(4).click({ button: "right" });
    const menu = page.locator(".f-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".f-menu-item > span:first-child")).toHaveText(["Open at 0:06", "Show in Explorer", "Copy", "Copy Path"]);
    expect(await selectedName(page)).toBe("dog on the beach.mp4");
    await shot(page, testInfo, "panel-menu");
    await menu.getByText("Copy Path").click();
    expect(await calls(page, "copy_text")).toEqual([{ text: VIDEO.path }]);
    await expect(menu).toBeHidden();
    await page.locator(".row").nth(4).click({ button: "right" });
    await menu.getByText("Copy", { exact: true }).click();
    expect(await calls(page, "copy_file")).toEqual([{ path: VIDEO.path }]);
    await page.locator(".row").nth(4).click({ button: "right" });
    await menu.getByText("Show in Explorer").click();
    expect(await calls(page, "reveal")).toEqual([{ path: VIDEO.path }]);
    await page.locator(".row").nth(4).click({ button: "right" });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await page.waitForTimeout(200);
    expect(await calls(page, "hide_panel")).toEqual([]);
    await page.locator(".row").nth(4).click({ button: "right" });
    await menu.getByText("Open at 0:06").click();
    expect(await calls(page, "open_path")).toEqual([{ path: VIDEO.path, seconds: 6 }]);
  });

  test("a row pressed and moved is dragged out as the file, its picture under the pointer", async ({ page }) => {
    await openPanel(page);
    await search(page, "receipt");
    const row = page.locator(".row").nth(1);
    await expect(row.locator("img.thumb")).toHaveAttribute("src", /digup-ui-fixtures/);
    const box = await row.boundingBox();
    await page.mouse.move(box.x + 40, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 30);
    await page.mouse.up();
    const drags = await calls(page, "drag_out");
    expect(drags).toHaveLength(1);
    expect(drags[0].path).toBe(IMAGE.path);
    expect(drags[0].icon).toMatch(/digup-ui-fixtures/);
  });

  test("the shell's icon stands in for documents and code", async ({ page }) => {
    const icon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await openPanel(page, { responses: { file_icon: icon } });
    await search(page, "receipt");
    await expect(page.locator(".row").nth(3).locator(".thumb.icon img.file-icon")).toHaveAttribute("src", icon);
    const asks = await calls(page, "file_icon");
    expect(asks).toContainEqual({ path: DOC.path, size: 36 });
  });
});

test.describe("states", () => {
  test("nothing typed: only the field", async ({ page }, testInfo) => {
    await openPanel(page, { height: 56 });
    await expect(page.locator("#body")).toBeHidden();
    await expect(page.locator("#footer")).toBeHidden();
    await expect(page.locator("#query")).toHaveAttribute("placeholder", "Describe it: “zebra in a video”, “code: retry with backoff”…");
    await shot(page, testInfo, "panel-empty");
  });

  test("without code search the placeholder has no code example", async ({ page }) => {
    await openPanel(page, { state: { hasCode: false } });
    await expect(page.locator("#query")).toHaveAttribute("placeholder", "Describe it: “payment error screenshot”, “zebra in a video”…");
  });

  test("no folders chosen yet", async ({ page }, testInfo) => {
    await openPanel(page, { state: { hasFolders: false }, helper: { hits: [] } });
    await page.locator("#query").fill("receipt");
    await expect(page.locator(".message strong")).toHaveText("No folders chosen yet");
    await expect(page.locator(".message > span")).toHaveText("DigUp only searches the folders you pick.");
    await shot(page, testInfo, "panel-no-folders");
    await page.getByRole("button", { name: "Choose Folders…" }).click();
    expect(await calls(page, "choose_folders")).toHaveLength(1);
  });

  test("no good matches", async ({ page }) => {
    await openPanel(page, { helper: { hits: [] } });
    await page.locator("#query").fill("zebra");
    await expect(page.locator(".message strong")).toHaveText("No good matches");
    await expect(page.locator(".message > span")).toHaveText("Try what you'd see or hear in it, or words you remember from it.");
    await expect(page.locator("#summary")).toHaveText("0 results");
  });

  test("code: alone shows what to type, with examples to click", async ({ page }, testInfo) => {
    await openPanel(page);
    await page.locator("#query").fill("code:");
    await expect(page.locator(".message strong")).toHaveText("Search your code");
    await expect(page.locator(".message > span")).toHaveText("Say what the code does, or type a name that's in it.");
    await expect(page.locator(".code-example")).toHaveText(["code: retry a request with backoff",
      "code: where the settings are saved", "code: parse the command line options"]);
    await expect(page.locator("#summary")).toHaveText("Searching your code");
    await expect(page.locator("#glass")).toHaveAttribute("title", "Searching your code");
    await expect(page.locator("#glass")).toHaveClass(/code/);
    await shot(page, testInfo, "panel-code-hint");
    await page.locator(".code-example").first().click();
    await expect(page.locator("#query")).toHaveValue("code: retry a request with backoff");
    const searches = await asked(page, "search");
    expect(searches.at(-1)).toMatchObject({ q: "retry a request with backoff", code: true });
    expect(await page.evaluate(() => document.activeElement.id)).toBe("query");
  });

  test("code search off says how to turn it on", async ({ page }, testInfo) => {
    await openPanel(page, { state: { hasCode: false } });
    await page.locator("#query").fill("code: retry");
    await expect(page.locator(".message strong")).toHaveText("Code search is off");
    await expect(page.locator(".message > span")).toHaveText("DigUp can find code by what it does, in the folders you "
      + "pick. Code gets an index of its own and never shows up in other searches.");
    await expect(page.locator("#summary")).toHaveText("Code search is off");
    await shot(page, testInfo, "panel-code-off");
    await page.getByRole("button", { name: "Choose Code Folders…" }).click();
    expect(await calls(page, "choose_code_folders")).toHaveLength(1);
    expect(await asked(page, "search")).toEqual([]);
  });

  test("code results", async ({ page }, testInfo) => {
    await openPanel(page);
    await search(page, "code: retry");
    await expect(page.locator(".group-title")).toHaveText(["Code"]);
    // Code rows say where they are in their repo, not the lines.
    await expect(page.locator(".row").first().locator(".row-sub")).toHaveText("billing\\payments");
    await shot(page, testInfo, "panel-code");
  });

  test("the footer: words first, the model's caveat, code still being read", async ({ page }) => {
    await openPanel(page, { helper: { delay: 400, meaning: false },
                            state: { caveat: "Matching words only until the model has downloaded (42%)", model: { state: "downloading" } } });
    await page.locator("#query").fill("receipt");
    await expect(page.locator("#summary")).toHaveText("Matching words…");
    await page.evaluate(() => window.__mock.emit("helper", { from: "search", event: { event: "encoder", state: "starting" } }));
    await expect(page.locator("#summary")).toHaveText("Matching words; meaning search is warming up…");
    await expect(page.locator("#spinner")).toBeVisible();
    await expect(page.locator("#summary")).toHaveText("Matching words only until the model has downloaded (42%)");
    await expect(page.locator("#spinner")).toBeHidden();
  });

  test("still reading code", async ({ page }) => {
    await openPanel(page, { state: { codeIndexing: { done: 21, total: 50 } } });
    await page.locator("#query").fill("code: retry");
    await expect(page.locator("#summary")).toHaveText("Still reading code (42%): some isn't in yet");
  });

  test("the activity badge beside the field", async ({ page }) => {
    await openPanel(page, { state: { badge: "Indexing 42%", progress: 0.42, line: "Indexing 42% · 420 of 1,000" } });
    await expect(page.locator("#activity")).toHaveText("Indexing 42%");
    await expect(page.locator("#activity")).toHaveAttribute("title", "Indexing 42% · 420 of 1,000");
  });
});

test.describe("speed", () => {
  test("the meaning search goes out at the keystroke and shows at the 120 ms deadline", async ({ page }) => {
    await openPanel(page);
    const timing = await page.evaluate(async () => {
      const field = document.getElementById("query");
      field.value = "receipt";
      const typed = performance.now();
      field.dispatchEvent(new Event("input"));
      const meaningAsked = window.__asked.filter((request) => request.op === "search" && request.meaning).length;
      await new Promise((done) => setTimeout(done, 60));
      const at60 = document.getElementById("summary").textContent;
      await new Promise((done) => {
        const watch = new MutationObserver(() => {
          if (/results/.test(document.getElementById("summary").textContent)) done();
        });
        watch.observe(document.getElementById("summary"), { childList: true, characterData: true, subtree: true });
      });
      return { meaningAsked, at60, shownAfter: performance.now() - typed };
    });
    expect(timing.meaningAsked).toBe(1);        // asked before the pause is over: no 120 ms timer first
    expect(timing.at60).toBe("Matching words…"); // the words show at once
    expect(timing.shownAfter).toBeGreaterThanOrEqual(119);
    expect(timing.shownAfter).toBeLessThan(400);
    expect(await asked(page, "embed_ahead")).toEqual([]);
  });

  test("one meaning search is out at a time, and only the latest query's shows", async ({ page }) => {
    await openPanel(page, { helper: { delay: 200 } });
    await page.evaluate(async () => {
      const field = document.getElementById("query");
      for (const text of ["rec", "rece", "receipt"]) {
        field.value = text;
        field.dispatchEvent(new Event("input"));
        await new Promise((done) => setTimeout(done, 20));
      }
    });
    await expect(page.locator("#summary")).toHaveText("6 results");
    const meaningQueries = (await asked(page, "search")).filter((request) => request.meaning).map((request) => request.q);
    expect(meaningQueries).toEqual(["rec", "receipt"]);   // "rece" was dropped while "rec" was out
    expect(await page.evaluate(() => state.text)).toBe("receipt");
  });
});

test.describe("look", () => {
  for (const backdrop of [false, true]) {
    test(`results over ${backdrop ? "Acrylic" : "a solid surface"}`, async ({ page }, testInfo) => {
      await openPanel(page, { backdrop });
      await search(page, "receipt");
      const panel = page.locator("#panel");
      if (backdrop) {
        await expect(page.locator("html")).toHaveAttribute("data-backdrop", "");
        await expect(panel).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(panel).toHaveCSS("border-radius", "0px");
      } else {
        await expect(panel).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(panel).toHaveCSS("border-radius", "8px");
      }
      // Selection is the accent's, with its pill.
      const pill = await page.locator(".row.selected").evaluate((row) => getComputedStyle(row, "::before").backgroundColor);
      expect(pill).toMatch(/rgb\((0, 95, 184|96, 205, 255|0, 90, 158|118, 185, 237)\)/);
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(150);
      await shot(page, testInfo, `panel-results-${backdrop ? "acrylic" : "solid"}`);
      await search(page, "code: retry");
      await page.waitForTimeout(150);
      await shot(page, testInfo, `panel-code-${backdrop ? "acrylic" : "solid"}`);
    });
  }
});
