// The search window (window.html): the grid, the filters, the preview pane and the big preview, its keys and what it
// asks of the shell, as the Mac app's window (SearchWindow.swift) behaves, in Windows 11's look.
const { test, expect } = require("@playwright/test");
const { openPage, shot, calls } = require("./helpers");
const { HITS, CODE_HITS, STATE, HOME, helperScript } = require("./search-fixtures");

const ACCENT = ["#a6d8ff", "#76b9ed", "#429ce3", "#0078d4", "#005a9e", "#004275", "#002642"];
const [SCREENSHOT, IMAGE, PDF, DOC, VIDEO] = HITS;

/// The window with the helper's stand-in; `backdrop` puts it over Mica (drawn here as a tinted wash, which is what
/// shows through a transparent page).
async function openWindow(page, { info = {}, state = {}, helper = {}, backdrop = false, responses = {}, width = 1100 } = {}) {
  await page.setViewportSize({ width, height: 720 });
  await openPage(page, "window.html", {
    system_look: { backdrop, accent: ACCENT },
    window_info: { folders: [`${HOME}\\Pictures`, `${HOME}\\Documents`], hotkey: "Ctrl+Shift+Space",
                   state: { ...STATE, ...state }, search: null, hasCode: true, ...info },
    opens_at_moment: true,
    ...responses,
  }, { setup: { content: helperScript(helper) } });
  if (backdrop) {
    await page.addStyleTag({ content: "html { background: linear-gradient(160deg, #e6ecf3, #efe9e4); } "
      + "@media (prefers-color-scheme: dark) { html { background: linear-gradient(160deg, #1b2027, #26221f); } }" });
  }
  await expect(page.locator("#query")).toBeFocused();
}

async function search(page, text) {
  await page.locator("#query").fill(text);
  await expect(page.locator("#count")).toHaveText(/results?/);
}

const selectedPath = (page) => page.locator("[data-path].selected").getAttribute("data-path");
const asked = (page, op) => page.evaluate((op) => window.__asked.filter((request) => request.op === op), op);

test.describe("results", () => {
  test("the home, then a grid with counts on the filters and the selected one previewed", async ({ page }, testInfo) => {
    await openWindow(page);
    await expect(page.locator(".home h1")).toHaveText("Describe it. Dig it up.");
    await expect(page.locator(".about .line").first()).toContainText("in Pictures and Documents");
    await page.waitForTimeout(150);
    await shot(page, testInfo, "window-home");
    await search(page, "receipt");
    await expect(page.locator(".chip")).toHaveText(["All", "Screenshots1", "Images1", "Documents2", "Video1", "Audio1", "Code"]);
    await expect(page.locator(".chip.selected")).toHaveText("All");
    await expect(page.locator(".cell")).toHaveCount(6);
    expect(await selectedPath(page)).toBe(SCREENSHOT.path);
    await expect(page.locator(".side .open")).toHaveText("Open");
    await expect(page.locator("#count")).toHaveText("6 results");
    await page.waitForTimeout(200);
    await shot(page, testInfo, "window-grid");
  });

  test("the grid's pictures are 176 to 230 wide", async ({ page }) => {
    await openWindow(page, { width: 1500 });
    await search(page, "receipt");
    const widths = await page.locator(".cell .picture").evaluateAll((pictures) => pictures.map((picture) => picture.getBoundingClientRect().width));
    for (const width of widths) {
      expect(width).toBeGreaterThanOrEqual(176);
      expect(width).toBeLessThanOrEqual(230);
    }
    expect(await page.evaluate(() => columns())).toBe(6);
  });

  test("a filter shows one kind, asked of the helper beside the search of everything", async ({ page }) => {
    await openWindow(page);
    await search(page, "receipt");
    await page.keyboard.press("Control+4");
    await expect(page.locator(".chip.selected")).toHaveText("Documents2");
    await expect(page.locator(".cell")).toHaveCount(2);
    const searches = await asked(page, "search");
    const [all, documents] = searches.slice(-2);
    expect(all).toMatchObject({ q: "receipt", meaning: true, limit: 120 });
    expect(all.kinds).toBeUndefined();
    expect(documents).toMatchObject({ q: "receipt", kinds: ["pdf", "doc"] });
    expect(documents.at - all.at).toBeLessThan(5);   // together, not one after the other
    await page.keyboard.press("Control+1");
    await expect(page.locator(".cell")).toHaveCount(6);
    await page.locator(".chip", { hasText: "Video" }).click();
    await expect(page.locator(".cell")).toHaveCount(1);
  });

  test("code: a list with the shell's icons, the editor's name, the lines", async ({ page }, testInfo) => {
    await openWindow(page);
    await search(page, "code: retry");
    await expect(page.locator(".chip.selected")).toHaveText("Code2");
    await expect(page.locator(".code-list .row")).toHaveCount(2);
    await expect(page.locator(".row.selected .folder")).toHaveText("billing\\payments");
    await expect(page.locator(".side .open")).toHaveText("Open in Visual Studio Code");
    await expect(page.locator(".side .code-lines .line.focus")).toContainText("export async function retry");
    await page.waitForTimeout(150);
    await shot(page, testInfo, "window-list");
    await page.keyboard.press("Enter");
    expect(await calls(page, "open_code")).toEqual([{ path: CODE_HITS[0].path, line: 14 }]);
  });
});

test.describe("keys", () => {
  test("↓ ↑ move by a row, ← → by one once you've arrowed", async ({ page }) => {
    await openWindow(page);
    await search(page, "receipt");
    const columns = await page.evaluate(() => columns());
    expect(columns).toBe(3);
    await page.keyboard.press("ArrowRight");   // still the field's: the cursor moves
    expect(await selectedPath(page)).toBe(SCREENSHOT.path);
    await page.keyboard.press("ArrowDown");
    expect(await selectedPath(page)).toBe(DOC.path);
    await page.keyboard.press("ArrowRight");
    expect(await selectedPath(page)).toBe(VIDEO.path);
    await page.keyboard.press("ArrowUp");
    expect(await selectedPath(page)).toBe(IMAGE.path);
    await expect(page.locator(".side .facts .title")).toHaveText(/beach dog\.jpg/);
  });

  test("Enter opens, Ctrl+Enter shows in Explorer, a double-click opens", async ({ page }) => {
    await openWindow(page);
    await search(page, "receipt");
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+Enter");
    await page.locator(".cell").nth(2).dblclick();
    expect(await calls(page, "open_path")).toEqual([{ path: SCREENSHOT.path }, { path: VIDEO.path, seconds: 6 },
                                                    { path: PDF.path, page: 3 }]);
    expect(await calls(page, "reveal")).toEqual([{ path: VIDEO.path }]);
  });

  test("Space shows the big preview once a result is picked; Esc closes it, then clears the search", async ({ page }, testInfo) => {
    await openWindow(page);
    await search(page, "receipt");
    await page.keyboard.press("Space");
    await expect(page.locator("#query")).toHaveValue("receipt ");
    await expect(page.locator("#count")).toHaveText("6 results");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await expect(page.locator(".big .sheet")).toBeVisible();
    await expect(page.locator(".big .name")).toHaveText("dog on the beach.mp4");
    await expect(page.locator(".big .f-button.accent")).toHaveText("Open at 0:06");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(".big .name")).toHaveText("beach dog.jpg");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".big .name")).toHaveText("hardware store receipt.pdf");
    await expect(page.locator(".big img")).toHaveAttribute("src", /digup-ui-fixtures/);
    await page.waitForTimeout(250);
    await shot(page, testInfo, "window-big");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".big .name")).toHaveText("budget meeting.docx");
    await expect(page.locator(".big .passage mark").first()).toHaveText("receipt");
    await page.keyboard.press("Escape");
    await expect(page.locator(".big")).toBeHidden();
    await expect(page.locator("#query")).toHaveValue("receipt ");
    await page.keyboard.press("Escape");
    await expect(page.locator("#query")).toHaveValue("");
    await expect(page.locator(".home")).toBeVisible();
  });

  test("the big preview's Open and ×", async ({ page }) => {
    await openWindow(page);
    await search(page, "receipt");
    await page.keyboard.press("Control+y");
    await expect(page.locator(".big .sheet")).toBeVisible();
    await page.locator(".big .close").click();
    await expect(page.locator(".big")).toBeHidden();
    await page.keyboard.press("Control+y");
    await page.locator(".big .f-button.accent").click();
    await expect(page.locator(".big")).toBeHidden();
    expect(await calls(page, "open_path")).toEqual([{ path: SCREENSHOT.path }]);
  });

  test("Ctrl+C copies the file once a result is picked", async ({ page }) => {
    await openWindow(page);
    await search(page, "receipt");
    await page.keyboard.press("Control+c");
    expect(await calls(page, "copy_file")).toEqual([]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Control+c");
    expect(await calls(page, "copy_file")).toEqual([{ path: DOC.path }]);
  });

  test("Ctrl+, opens Settings, Ctrl+N starts a new search, the status line opens Folders", async ({ page }) => {
    await openWindow(page);
    await search(page, "receipt");
    await page.keyboard.press("Control+4");
    await page.keyboard.press("Control+,");
    expect(await calls(page, "open_settings")).toEqual([{}]);
    await page.keyboard.press("Control+n");
    await expect(page.locator("#query")).toHaveValue("");
    await expect(page.locator(".chip.selected")).toHaveText("All");
    await page.locator("#status-line").click();
    await page.locator("#settings").click();
    expect(await calls(page, "open_settings")).toEqual([{}, { tab: "folders" }, {}]);
  });

  test("typing anywhere goes to the field", async ({ page }) => {
    await openWindow(page);
    await search(page, "receipt");
    await page.locator(".cell").nth(1).click();
    expect(await page.evaluate(() => document.activeElement.id)).toBe("query");
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.type("s");
    await expect(page.locator("#query")).toHaveValue("receipts");
  });
});

test.describe("menus", () => {
  test("right-click on a result, as a Fluent menu", async ({ page }, testInfo) => {
    await openWindow(page);
    await search(page, "receipt");
    await page.locator(".cell").nth(4).click({ button: "right" });
    const menu = page.locator(".f-menu");
    await expect(menu.locator(".f-menu-item > span:first-child")).toHaveText(["Open at 0:06", "Show in Explorer", "Copy", "Copy Path"]);
    expect(await selectedPath(page)).toBe(VIDEO.path);
    await page.waitForTimeout(260);
    await shot(page, testInfo, "window-menu");
    await menu.getByText("Copy Path").click();
    expect(await calls(page, "copy_text")).toEqual([{ text: VIDEO.path }]);
    await page.locator(".cell").nth(4).click({ button: "right" });
    await menu.getByText("Show in Explorer").click();
    expect(await calls(page, "reveal")).toEqual([{ path: VIDEO.path }]);
  });

  test("⋯ has what the tray's menu has", async ({ page }) => {
    await openWindow(page);
    await page.locator("#more").click();
    await expect(page.locator(".f-menu .f-menu-item > span:first-child")).toHaveText(["Choose Folders…", "Index Now",
      "Pause Indexing", "Settings…", "Check for Updates…", "Quit DigUp"]);
    await page.locator(".f-menu").getByText("Settings…").click();
    expect(await calls(page, "open_settings")).toEqual([{}]);
  });

  test("a result pressed and moved is dragged out as the file", async ({ page }) => {
    await openWindow(page);
    await search(page, "receipt");
    const cell = page.locator(".cell").nth(1);
    await expect(cell.locator("img")).toHaveAttribute("src", /digup-ui-fixtures/);
    const box = await cell.boundingBox();
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 70);
    await page.mouse.up();
    const drags = await calls(page, "drag_out");
    expect(drags).toHaveLength(1);
    expect(drags[0]).toMatchObject({ path: IMAGE.path, icon: expect.stringContaining("digup-ui-fixtures") });
  });
});

test.describe("states", () => {
  test("no folders yet", async ({ page }) => {
    await openWindow(page, { info: { folders: [] } });
    await expect(page.locator(".center h2")).toHaveText("Choose folders to search");
    await page.getByRole("button", { name: "Choose Folders…" }).click();
    expect(await calls(page, "choose_folders")).toHaveLength(1);
  });

  test("code: alone, and code search off", async ({ page }, testInfo) => {
    await openWindow(page, { info: { hasCode: false }, state: { hasCode: false } });
    await page.locator("#query").fill("code: retry");
    await expect(page.locator(".center h3")).toHaveText("Code search is off");
    await expect(page.locator(".center p")).toHaveText("DigUp can find code by what it does, in the folders you pick. "
      + "Code gets an index of its own and never shows up in other searches.");
    await expect(page.locator(".center .f-button")).not.toHaveClass(/accent/);
    await shot(page, testInfo, "window-code-off");
    await page.getByRole("button", { name: "Choose Code Folders…" }).click();
    expect(await calls(page, "choose_code_folders")).toHaveLength(1);
  });

  test("nothing found", async ({ page }) => {
    await openWindow(page, { helper: { hits: [] } });
    await page.locator("#query").fill("zebra");
    await expect(page.locator(".center h3")).toHaveText("No good matches for “zebra”");
  });
});

test.describe("speed", () => {
  test("the search goes out at the keystroke and shows at the 120 ms deadline", async ({ page }) => {
    await openWindow(page);
    const timing = await page.evaluate(async () => {
      const field = document.getElementById("query");
      field.value = "receipt";
      const typed = performance.now();
      field.dispatchEvent(new Event("input"));
      const searched = window.__asked.filter((request) => request.op === "search").length;
      await new Promise((done) => {
        const watch = new MutationObserver(() => { if (document.querySelector(".cell")) done(); });
        watch.observe(document.getElementById("content"), { childList: true, subtree: true });
      });
      return { searched, shownAfter: performance.now() - typed };
    });
    expect(timing.searched).toBe(1);
    expect(timing.shownAfter).toBeGreaterThanOrEqual(119);
    expect(timing.shownAfter).toBeLessThan(400);
  });

  test("typing fast: one search out at a time, the latest shown", async ({ page }) => {
    await openWindow(page, { helper: { delay: 200 } });
    await page.evaluate(async () => {
      const field = document.getElementById("query");
      for (const text of ["dog", "dog o", "dog on the"]) {
        field.value = text;
        field.dispatchEvent(new Event("input"));
        await new Promise((done) => setTimeout(done, 20));
      }
    });
    await expect(page.locator("#count")).toHaveText("6 results");
    expect((await asked(page, "search")).map((request) => request.q)).toEqual(["dog", "dog on the"]);
    expect(await page.evaluate(() => state.text)).toBe("dog on the");
  });
});

test.describe("look", () => {
  for (const backdrop of [false, true]) {
    test(`over ${backdrop ? "Mica" : "a solid surface"}`, async ({ page }, testInfo) => {
      await openWindow(page, { backdrop });
      await expect(page.locator("body")).toHaveCSS("background-color", backdrop ? "rgba(0, 0, 0, 0)" : /rgb\(/);
      await search(page, "receipt");
      await page.keyboard.press("ArrowDown");
      // The selection and the checked filter are the person's accent.
      const accent = await page.locator(".chip.selected").evaluate((chip) => getComputedStyle(chip).backgroundColor);
      expect(accent).toMatch(/rgb\((0, 90, 158|118, 185, 237)\)/);
      await expect(page.locator(".cell.selected")).toHaveCSS("box-shadow", new RegExp(accent.replace(/[()]/g, "\\$&")));
      await expect(page.locator(".cell .picture").first()).toHaveCSS("border-radius", "8px");
      await page.waitForTimeout(200);
      await shot(page, testInfo, `window-grid-${backdrop ? "mica" : "solid"}`);
      await page.keyboard.press("Space");
      await page.waitForTimeout(260);
      await shot(page, testInfo, `window-big-${backdrop ? "mica" : "solid"}`);
      await page.keyboard.press("Escape");
      await search(page, "code: retry");
      await page.waitForTimeout(150);
      await shot(page, testInfo, `window-list-${backdrop ? "mica" : "solid"}`);
    });
  }
});
