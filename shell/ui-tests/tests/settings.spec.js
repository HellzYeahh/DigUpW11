// settings.html: the tabs (mouse and keys, ?tab= and the settings-tab event), every switch and what it asks the shell,
// the confirmations, Add Folders (picker, estimates, summary, Add), the shortcut recorder, the model's download
// recovery, and the Mica backdrop. With SHOTS set, a screenshot of every tab and dialog, with and without the backdrop.
const { test, expect } = require("@playwright/test");
const { openPage, shot, calls } = require("./helpers");

const HOME = "C:\\Users\\Yass";

function settingsInfo(overrides = {}) {
  return {
    openAtLogin: true,
    canOpenAtLogin: true,
    centered: false,
    processorOnly: false,
    canChooseTrayClick: true,
    trayClick: "window",
    canCenter: true,
    hotkey: "Ctrl+Alt+Space",
    shortcut: { method: "grab", command: "digup --toggle" },
    folders: [`${HOME}\\Documents`, `${HOME}\\Pictures`, "D:\\Archive"],
    skipped: [`${HOME}\\Documents\\Old`],
    skipTypes: ["heic"],
    indexHours: { on: false, start: 60, end: 420 },
    indexOnBattery: true,
    onBattery: false,
    storage: { index: `${HOME}\\AppData\\Local\\DigUp\\Index`, indexBytes: 48_200_000, codeBytes: 12_400_000,
               models: `${HOME}\\AppData\\Local\\DigUp\\Models` },
    code: { folders: [`${HOME}\\src`], skipped: [], editor: "vscode",
            editors: [{ id: "vscode", name: "Visual Studio Code" }, { id: "notepadpp", name: "Notepad++" }] },
    state: { line: "1,204 files indexed", progress: null, files: 1210, searchable: 1204, pending: 6, unfinished: 2,
             paused: false, hasCode: true, model: { state: "ready" }, update: null },
    updateChecks: true,
    installsUpdates: true,
    version: "0.7.0",
    licenses: true,
    debug: false,
    ...overrides,
  };
}

const SUMMARIES = [
  { path: "C:/Users/Yass/Documents", files: 412, indexed: 410, pending: 2, unfinished: 1, skipped: 0, failed: 0,
    kinds: { pdf: 120, doc: 290, image: 2 } },
  { path: "C:/Users/Yass/Pictures", files: 760, indexed: 756, pending: 4, unfinished: 0, skipped: 3, failed: 1,
    kinds: { screenshot: 136, image: 620, video: 4 } },
  { path: "D:/Archive", missing: true, files: 38, indexed: 38, pending: 0, unfinished: 0, skipped: 0, failed: 0,
    kinds: { audio: 30, pdf: 8 } },
];
const CODE_SUMMARIES = [
  { path: "C:/Users/Yass/src", files: 812, indexed: 812, pending: 0, unfinished: 0, skipped: 0, failed: 0, kinds: { code: 812 } },
];

/// What `digup estimate --json` answers for a folder: by name, so a test's folders get believable numbers.
const ESTIMATES = {
  Desktop: { seconds: 95, later_seconds: 0, files: { image: 40, pdf: 6, doc: 12 },
             subfolders: [{ folder: "C:/Users/Yass/Desktop/Shots", seconds: 40, files: { screenshot: 30 } },
                          { folder: "C:/Users/Yass/Desktop/Notes", seconds: 20, files: { doc: 12 } }] },
  Downloads: { seconds: 610, later_seconds: 900, files: { pdf: 210, video: 12, audio: 6 }, subfolders: [] },
  Photos: { seconds: 300, later_seconds: 0, files: { image: 1500 }, subfolders: [] },
};

// The page's answers, from window.__fx (set below) so the functions can run inside the page.
const FIXTURES = (overrides = {}, fx = {}) => ({
  responses: {
    system_look: { backdrop: false, accent: null },
    settings_info: settingsInfo(overrides),
    ask: (args) => (args.request.code ? { roots: window.__fx.codeSummaries } : { roots: window.__fx.summaries }),
    setup_info: () => ({ offered: window.__fx.offered }),
    code_setup_info: () => ({ offered: [] }),
    estimate: (args) => args.folders.map((folder) => {
      const name = folder.split(/[\\/]/).pop();
      return { folder: folder.replaceAll("\\", "/"), readable: true, calibrated: true,
               ...(window.__fx.estimates[name] || { seconds: 1, files: {}, subfolders: [] }) };
    }),
    pick_folders: () => window.__fx.picks.shift() || [],
    file_icon: () => null,
    set_hotkey: (args) => (window.__fx.hotkeyProblem ? new Error(window.__fx.hotkeyProblem) : args.hotkey),
    model_links: ["https://huggingface.co/a.gguf", "https://huggingface.co/b.gguf"],
    use_model_files: () => window.__fx.useFiles || { ok: false, message: null },
  },
  setup: `window.__fx = ${JSON.stringify({
    summaries: SUMMARIES, codeSummaries: CODE_SUMMARIES, estimates: ESTIMATES, picks: [],
    offered: [`${HOME}\\Documents`, `${HOME}\\Pictures`, `${HOME}\\Desktop`, `${HOME}\\Downloads`], ...fx,
  })};`,
});

async function open(page, { overrides, fx, responses = {}, query = "", backdrop = false } = {}) {
  const fixtures = FIXTURES(overrides, fx);
  fixtures.responses.system_look = { backdrop, accent: null };
  await page.setViewportSize({ width: 660, height: 620 });   // the Settings window's size (main.rs)
  await openPage(page, `settings.html${query}`, { ...fixtures.responses, ...responses }, { setup: fixtures.setup });
  await expect(page.locator("#update-version")).toHaveText(/DigUp/);
  if (backdrop) {
    // Mica stands in: the window's tint behind a transparent page.
    await page.addStyleTag({ content: `html { background: ${await page.evaluate(() =>
      matchMedia("(prefers-color-scheme: dark)").matches)
      ? "linear-gradient(135deg, #20262b, #252220)" : "linear-gradient(135deg, #e9eef3, #f3eee9)"} !important; }` });
  }
}

const selectedTab = (page) => page.locator('#tabs [aria-selected="true"]');

// MARK: Tabs

test("tabs switch by click, arrows, Home and End, and Ctrl+Tab", async ({ page }) => {
  await open(page);
  await expect(selectedTab(page)).toHaveText("General");
  await expect(page.locator("#general")).toBeVisible();

  await page.getByRole("tab", { name: "Folders" }).click();
  await expect(selectedTab(page)).toHaveText("Folders");
  await expect(page.locator("#folders")).toBeVisible();
  await expect(page.locator("#general")).toBeHidden();

  await page.keyboard.press("ArrowRight");
  await expect(selectedTab(page)).toHaveText("Code");
  await expect(page.getByRole("tab", { name: "Code" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(selectedTab(page)).toHaveText("Storage");
  await page.keyboard.press("ArrowRight");   // wraps around
  await expect(selectedTab(page)).toHaveText("General");
  await page.keyboard.press("ArrowLeft");
  await expect(selectedTab(page)).toHaveText("Storage");
  await page.keyboard.press("Home");
  await expect(selectedTab(page)).toHaveText("General");

  // Anywhere on the page: Ctrl+Tab and Ctrl+Shift+Tab, Ctrl+Page Down and Up.
  await page.locator("#types").focus();
  await page.keyboard.press("Control+Tab");
  await expect(selectedTab(page)).toHaveText("Folders");
  await page.keyboard.press("Control+Shift+Tab");
  await expect(selectedTab(page)).toHaveText("General");
  await page.keyboard.press("Control+PageDown");
  await page.keyboard.press("Control+PageDown");
  await expect(selectedTab(page)).toHaveText("Code");
  await page.keyboard.press("Control+PageUp");
  await expect(selectedTab(page)).toHaveText("Folders");
  // Only the selected tab is in the Tab order.
  await expect(page.locator("#tabs [tabindex='0']")).toHaveCount(1);
});

test("Ctrl+W closes the window", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+w");
  expect(await calls(page, "close_window")).toHaveLength(1);
});

test("opens at the tab asked for, and the settings-tab event changes it", async ({ page }) => {
  await open(page, { query: "?tab=folders" });
  await expect(selectedTab(page)).toHaveText("Folders");
  await expect(page.locator("#folder-rows .folder-row")).toHaveCount(3);
  await page.evaluate(() => window.__mock.emit("settings-tab", "code"));
  await expect(selectedTab(page)).toHaveText("Code");
  await expect(page.locator("#code")).toBeVisible();
  await page.evaluate(() => window.__mock.emit("settings-tab", "storage"));
  await expect(page.locator("#storage")).toBeVisible();
  await page.evaluate(() => window.__mock.emit("settings-tab", "nonsense"));
  await expect(selectedTab(page)).toHaveText("General");
});

// MARK: General

test("General follows the Mac's order and wording", async ({ page }, testInfo) => {
  await open(page);
  const titles = await page.locator("#general .f-card-title:visible").allTextContents();
  expect(titles.map((title) => title.trim())).toEqual(["Search shortcut", "Open DigUp when you log in",
    "Clicking DigUp's tray icon", "Center the search panel", "Run the model on the processor",
    "Check for updates automatically"]);
  await expect(page.locator("#login-info")).toHaveText("So the shortcut always works.");
  await expect(page.locator("#keys .key")).toHaveText(["Ctrl", "Alt", "Space"]);
  await expect(page.locator("#recorder-hint")).toHaveText("Click to change");
  await expect(page.locator("#update-version")).toHaveText("DigUp 0.7.0");
  await expect(page.locator("#login-option .switch-state")).toHaveCSS("display", "block");
  await shot(page, testInfo, "settings-general");
});

test("every switch asks the shell with its value", async ({ page }) => {
  await open(page);
  await page.locator("#login").click();
  expect(await calls(page, "set_open_at_login")).toEqual([{ on: false }]);
  await page.locator("#center").click();
  expect(await calls(page, "set_center_panel")).toEqual([{ on: true }]);
  await page.locator("#processor").click();
  expect(await calls(page, "set_processor_only")).toEqual([{ on: true }]);
  await page.locator("#update-checks").click();
  expect(await calls(page, "set_update_checks")).toEqual([{ on: false }]);
  await page.locator("#tray-click").selectOption("panel");
  expect(await calls(page, "set_tray_click")).toEqual([{ click: "panel" }]);

  await page.getByRole("tab", { name: "Folders" }).click();
  await page.locator("#battery").click();
  expect(await calls(page, "set_index_on_battery")).toEqual([{ on: false }]);
  await expect(page.locator("#times")).toBeHidden();
  await page.locator("#hours").click();
  expect(await calls(page, "set_index_hours")).toEqual([{ on: true, start: 60, end: 420 }]);
  await expect(page.locator("#times")).toBeVisible();
  await page.locator("#hours-end").fill("06:30");
  expect((await calls(page, "set_index_hours")).pop()).toEqual({ on: true, start: 60, end: 390 });

  await page.locator("#types").fill("heic, txt");
  await page.locator("#types").press("Enter");
  expect(await calls(page, "set_skip_types")).toEqual([{ types: "heic, txt" }]);

  await page.getByRole("tab", { name: "Code" }).click();
  await page.locator("#code-editor").selectOption("notepadpp");
  expect(await calls(page, "set_code_editor")).toEqual([{ editor: "notepadpp" }]);
});

test("the battery switch shows the setting, off when it's off", async ({ page }) => {
  await open(page, { overrides: { indexOnBattery: false, onBattery: true }, query: "?tab=folders" });
  await expect(page.locator("#battery")).not.toBeChecked();
  await expect(page.locator("#battery").locator("xpath=..").locator(".f-card-title")).toHaveText("Index on battery power");
  await page.locator("#battery").click();
  expect(await calls(page, "set_index_on_battery")).toEqual([{ on: true }]);
});

test("a switch the shell refuses goes back and says why", async ({ page }) => {
  await open(page, { responses: { set_open_at_login: () => new Error("Windows said no"),
                                  set_processor_only: () => new Error("can't save the settings") } });
  await page.locator("#login").click();
  await expect(page.locator("#login")).toBeChecked();
  await expect(page.locator("#login-info")).toHaveText("Windows said no");
  await expect(page.locator("#login-info")).toHaveClass(/problem-text/);
  await page.locator("#processor").click();
  await expect(page.locator("#processor")).not.toBeChecked();
  await expect(page.locator("#problem")).toBeVisible();
  await expect(page.locator("#problem-text")).toHaveText("can't save the settings");
  await page.locator("#problem-close").click();
  await expect(page.locator("#problem")).toBeHidden();
});

test("updates: Check Now, and the version waiting opens its offer", async ({ page }) => {
  const update = { version: "0.8.0", state: "available" };
  await open(page, { overrides: { state: { ...settingsInfo().state, update } } });
  await expect(page.locator("#update-version")).toHaveText("DigUp 0.8.0 is available");
  await page.locator("#update-version").click();
  expect(await calls(page, "offer_update")).toHaveLength(1);
  await page.locator("#check-now").click();
  expect(await calls(page, "check_for_updates")).toHaveLength(1);
  await page.evaluate(() => window.__mock.emit("state", { model: { state: "ready" },
    update: { version: "0.8.0", state: "downloading", percent: 40 } }));
  await expect(page.locator("#update-version")).toHaveText("Downloading DigUp 0.8.0… 40%");
});

// MARK: The shortcut recorder

test("the recorder takes a new shortcut, says what's wrong, and Esc cancels", async ({ page }, testInfo) => {
  await open(page);
  await page.locator("#recorder").click();
  await expect(page.locator("#recorder")).toHaveClass(/recording/);
  await expect(page.locator("#recorder")).toHaveText("Press the new shortcut…");
  await expect(page.locator("#recorder-hint")).toHaveText("Esc cancels");
  expect(await calls(page, "hold_hotkey")).toEqual([{ held: true }]);
  await shot(page, testInfo, "settings-shortcut-recording");

  await page.keyboard.press("KeyK");   // without a modifier
  await expect(page.locator("#recorder-hint")).toHaveText(/Add Ctrl, Alt or the Windows key/);
  await expect(page.locator("#recorder-hint")).toHaveClass(/problem-text/);
  await page.keyboard.press("Control+Shift+KeyK");
  expect(await calls(page, "set_hotkey")).toEqual([{ hotkey: "Ctrl+Shift+K" }]);
  await expect(page.locator("#recorder")).not.toHaveClass(/recording/);
  await expect(page.locator("#keys .key")).toHaveText(["Ctrl", "Shift", "K"]);
  await expect(page.locator("#recorder-hint")).toHaveText("Click to change");

  await page.locator("#recorder").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#recorder")).not.toHaveClass(/recording/);
  expect(await calls(page, "set_hotkey")).toHaveLength(1);

  // A second click stops listening too.
  await page.locator("#recorder").click();
  await expect(page.locator("#recorder")).toHaveClass(/recording/);
  await page.locator("#recorder").click();
  await expect(page.locator("#recorder")).not.toHaveClass(/recording/);
  expect((await calls(page, "hold_hotkey")).pop()).toEqual({ held: false });
});

test("a shortcut another app holds says so in red and keeps listening", async ({ page }) => {
  await open(page, { fx: { hotkeyProblem: "Ctrl+Alt+K can't be used: another app may have it." } });
  await page.locator("#recorder").click();
  await page.keyboard.press("Control+Alt+KeyK");
  await expect(page.locator("#recorder-hint")).toHaveText("Ctrl+Alt+K can't be used: another app may have it.");
  await expect(page.locator("#recorder")).toHaveClass(/recording/);
  await expect(page.locator("#problem")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator("#recorder")).not.toHaveClass(/recording/);
  await expect(page.locator("#recorder-hint")).toHaveText("Click to change");
});

test("where the desktop keeps the shortcut, the keys show with where to change it", async ({ page }, testInfo) => {
  await open(page, { overrides: { shortcut: { method: "by_hand", command: "/usr/bin/digup --toggle" } }, fx: {} },);
  await expect(page.locator("#recorder")).toBeDisabled();
  await expect(page.locator("#recorder-hint")).toBeHidden();
  await expect(page.locator("#shortcut-note-bar")).toBeVisible();
  await expect(page.locator("#shortcut-command")).toHaveText("/usr/bin/digup --toggle");
  await shot(page, testInfo, "settings-general-shortcut-by-hand");
});

// MARK: Folders

test("Folders shows each folder, what's in it, and what's skipped", async ({ page }, testInfo) => {
  await open(page, { query: "?tab=folders" });
  const rows = page.locator("#folder-rows .folder-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator(".row-name")).toHaveText("Documents");
  await expect(rows.nth(0).locator(".path")).toHaveText(`${HOME}\\Documents`);
  await expect(rows.nth(0).locator(".indexed")).toHaveText("410 of 412 indexed");
  await expect(rows.nth(0).locator(".states")).toHaveText("2 waiting · 1 long file to finish");
  await expect(rows.nth(1).locator(".kinds")).toHaveAttribute("title", "136 screenshots, 620 images, 4 videos");
  await expect(rows.nth(2).locator(".flag")).toHaveText("Not connected");
  await expect(rows.nth(2).locator(".indexed")).toHaveText("Kept for when it's back");
  await expect(rows.nth(2).locator(".folder-icon")).toHaveClass(/missing/);
  await expect(page.locator("#status-detail")).toHaveText("1,204 of 1,210 files searchable · 6 waiting · 2 long files to finish");
  await expect(page.locator("#skipped-rows .path")).toHaveText(`${HOME}\\Documents\\Old`);
  await expect(page.locator("#types-note")).toContainText("code is read only in the code folders (the Code tab)");
  await shot(page, testInfo, "settings-folders");
});

test("Folders without any, and with nothing skipped, say so", async ({ page }) => {
  await open(page, { overrides: { folders: [], skipped: [] }, fx: { summaries: [] }, query: "?tab=folders" });
  await expect(page.locator("#folder-rows")).toHaveText("No folders yet. Add the ones DigUp should search.");
  await expect(page.locator("#skipped-rows")).toHaveText(
    "None. Code projects, app bundles and caches are skipped anyway (code has its own tab).");
  await expect(page.locator("#pause")).toBeHidden();
});

test("Pause and Resume", async ({ page }) => {
  await open(page, { query: "?tab=folders" });
  await page.locator("#pause").click();
  expect(await calls(page, "pause_indexing")).toEqual([{ paused: true }]);
  await page.evaluate(() => window.__mock.emit("state", { line: "Paused · 6 files waiting", paused: true, files: 1210,
    searchable: 1204, pending: 6, model: { state: "ready" } }));
  await expect(page.locator("#pause")).toHaveText("Resume");
  await expect(page.locator("#status-line")).toHaveText("Paused · 6 files waiting");
});

test("removing a folder asks first, in a dialog: Cancel, Esc, then Remove", async ({ page }, testInfo) => {
  await open(page, { query: "?tab=folders" });
  const remove = page.getByRole("button", { name: "Remove Pictures" });
  await remove.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("h2")).toHaveText("Stop searching “Pictures”?");
  await expect(dialog.locator("p")).toHaveText("Its 760 files leave the index. Adding it back later indexes them again.");
  await expect(page.locator("#confirm-cancel")).toBeFocused();
  await page.waitForTimeout(300);   // the dialog's entrance
  await shot(page, testInfo, "settings-dialog-remove");
  await page.locator("#confirm-cancel").click();
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();

  await remove.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await calls(page, "remove_folder")).toEqual([]);

  // Tab stays inside the dialog.
  await remove.click();
  await page.keyboard.press("Tab");
  await expect(page.locator("#confirm-go")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#confirm-cancel")).toBeFocused();
  await page.locator("#confirm-go").click();
  expect(await calls(page, "remove_folder")).toEqual([{ folder: `${HOME}\\Pictures` }]);
  expect((await calls(page, "settings_info")).length).toBeGreaterThan(1);
});

test("a skipped folder is searched again with its button, and Skip a Folder… adds one", async ({ page }) => {
  await open(page, { query: "?tab=folders", fx: { picks: [[`${HOME}\\Pictures\\Raw`]] } });
  await page.getByRole("button", { name: "Search Old again" }).click();
  expect(await calls(page, "set_skipped")).toEqual([{ skipped: [] }]);
  await page.locator("#skip-folder").click();
  expect((await calls(page, "set_skipped")).pop()).toEqual({ skipped: [`${HOME}\\Documents\\Old`, `${HOME}\\Pictures\\Raw`] });
});

// MARK: Add Folders

test("Add Folders: the folders not searched yet, estimates, the summary, and Add", async ({ page }, testInfo) => {
  await open(page, { query: "?tab=folders", fx: { picks: [["E:\\Photos"], [`${HOME}\\Pictures\\Raw`]] } });
  await page.locator("#add-folders").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("h2")).toHaveText("Add folders to search");
  await expect(dialog.locator(".choice-name").first()).toHaveText("Desktop");
  // The usual folders that aren't searched, unchecked, estimated.
  await expect(dialog.locator(".choice")).toHaveCount(2);
  expect(await calls(page, "estimate")).toEqual([{ folders: [`${HOME}\\Desktop`, `${HOME}\\Downloads`], code: false }]);
  await expect(page.locator("#add-go")).toBeDisabled();
  await expect(page.locator("#add-summary")).toHaveText("Check the folders to add");
  await expect(dialog.locator(".choice").nth(0).locator(".time")).toHaveText("≈ 2 min");
  await expect(dialog.locator(".choice").nth(1).locator(".time")).toHaveText("≈ 10 min+ 15 min later");

  await dialog.locator(".choice").nth(1).locator(".f-check").click();
  await expect(page.locator("#add-go")).toBeEnabled();
  await expect(page.locator("#add-summary")).toHaveText("Adds about 10 min of indexing, and 15 min more for long files");
  await dialog.locator(".choice").nth(1).locator(".f-check").click();   // and off again
  await expect(page.locator("#add-go")).toBeDisabled();

  // Desktop, without one of its subfolders.
  await dialog.locator(".choice").nth(0).locator(".choice-head").click();
  await dialog.getByRole("button", { name: "Show the subfolders of Desktop" }).click();
  await dialog.locator(".subchoice").filter({ hasText: "Notes" }).click();
  await expect(dialog.locator(".choice").nth(0).locator(".choice-head .f-check")).toHaveJSProperty("indeterminate", true);
  await expect(page.locator("#add-summary")).toHaveText("Adds about 75 s of indexing");

  // Another folder, from the picker: listed and checked, then estimated.
  await page.locator("#choose-another").click();
  await expect(dialog.locator(".choice")).toHaveCount(3);
  expect((await calls(page, "estimate")).pop()).toEqual({ folders: ["E:\\Photos"], code: false });
  await expect(page.locator("#add-summary")).toHaveText("Adds about 6 min of indexing");
  // One searched already: a note says as part of what.
  await page.locator("#choose-another").click();
  await expect(page.locator("#choice-note")).toHaveText("“Raw” is searched already, as part of “Pictures”.");
  await page.waitForTimeout(300);
  await shot(page, testInfo, "settings-dialog-add-folders");

  await page.locator("#add-go").click();
  await expect(dialog).toBeHidden();
  expect(await calls(page, "apply_setup_folders")).toEqual([{
    folders: [`${HOME}\\Documents`, `${HOME}\\Pictures`, "D:\\Archive", `${HOME}\\Desktop`, "E:\\Photos"],
    skipped: [`${HOME}\\Documents\\Old`, `${HOME}\\Desktop\\Notes`],
  }]);
  expect((await calls(page, "settings_info")).length).toBeGreaterThan(1);
});

test("Add Folders with nothing to suggest starts from the picker; cancelling it opens nothing", async ({ page }) => {
  await open(page, { query: "?tab=folders", fx: { offered: [`${HOME}\\Documents`], picks: [[], ["E:\\Photos"]] } });
  await page.locator("#add-folders").click();
  expect(await calls(page, "pick_folders")).toHaveLength(1);
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.locator("#add-folders").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".choice")).toHaveCount(1);
  await expect(dialog.locator(".choice .f-check")).toBeChecked();
  await expect(page.locator("#add-summary")).toHaveText("Adds about 5 min of indexing");
  // Enter is Add.
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  expect(await calls(page, "apply_setup_folders")).toEqual([{
    folders: [`${HOME}\\Documents`, `${HOME}\\Pictures`, "D:\\Archive", "E:\\Photos"],
    skipped: [`${HOME}\\Documents\\Old`],
  }]);
});

test("Add Folders: Esc and Cancel change nothing; a refused Add says why", async ({ page }) => {
  await open(page, { query: "?tab=folders",
                     responses: { apply_setup_folders: () => new Error("can't save the settings: disk full") } });
  await page.locator("#add-folders").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.locator("#add-folders").click();
  await page.locator("#add-cancel").click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await calls(page, "apply_setup_folders")).toEqual([]);

  await page.locator("#add-folders").click();
  await page.locator(".choice .f-check").first().click();
  await page.locator("#add-go").click();
  await expect(page.locator("#add-summary")).toHaveText("can't save the settings: disk full");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("Code's Add Folders is the same dialog, for code search", async ({ page }) => {
  await open(page, { query: "?tab=code", fx: { picks: [[`${HOME}\\work`]] } });
  await page.locator("#add-code").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("h2")).toHaveText("Search your code");
  expect((await calls(page, "estimate")).pop()).toEqual({ folders: [`${HOME}\\work`], code: true });
  await page.locator("#add-go").click();
  expect(await calls(page, "set_code_folders")).toEqual([{ folders: [`${HOME}\\src`, `${HOME}\\work`], skipped: [] }]);
});

// MARK: Code

test("Code: the status, folders, editor and its note, and turning it off", async ({ page }, testInfo) => {
  await open(page, { query: "?tab=code" });
  await expect(page.locator("#code-status-line")).toHaveText("812 code files indexed");
  await expect(page.locator("#code-size")).toHaveText("12 MB");
  await expect(page.locator("#code-rows .folder-row .row-name")).toHaveText("src");
  await expect(page.locator("#editor-note")).toHaveText(
    "A result opens there at the line that matched. Space shows the whole file in DigUp's preview.");
  await expect(page.locator("#code-editor")).toHaveValue("vscode");
  await shot(page, testInfo, "settings-code");

  await page.locator("#code-off").click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.locator("h2")).toHaveText("Turn off code search?");
  await expect(dialog.locator("p")).toHaveText("The code index (12 MB) is deleted. Turning it on again reads the code again.");
  await expect(page.locator("#confirm-go")).toHaveText("Turn Off");
  await page.waitForTimeout(300);
  await shot(page, testInfo, "settings-dialog-code-off");
  await page.locator("#confirm-go").click();
  expect(await calls(page, "turn_off_code")).toHaveLength(1);

  await page.getByRole("button", { name: "Remove src" }).click();
  await expect(dialog.locator("h2")).toHaveText("Stop searching the code in “src”?");
  await expect(dialog.locator("p")).toHaveText("Its 812 code files leave the code index. That turns code search off.");
  await page.locator("#confirm-go").click();
  expect(await calls(page, "remove_code_folder")).toEqual([{ folder: `${HOME}\\src` }]);
});

test("Code off: no status, Choose Code Folders…", async ({ page }) => {
  await open(page, { query: "?tab=code", overrides: { code: { folders: [], skipped: [], editor: "default", editors: [] } } });
  await expect(page.locator("#code-status")).toBeHidden();
  await expect(page.locator("#code-off")).toBeHidden();
  await expect(page.locator("#add-code")).toHaveText("Choose Code Folders…");
  await expect(page.locator("#code-rows")).toHaveText("No code folders yet. Add the folders that hold your projects.");
});

test("Code waiting for the model, and behind the other files", async ({ page }) => {
  await open(page, { query: "?tab=code", fx: { codeSummaries: [{ ...CODE_SUMMARIES[0], indexed: 300, pending: 512 }] },
                     overrides: { state: { ...settingsInfo().state, model: { state: "downloading", bytes: 1, total: 2 } } } });
  await expect(page.locator("#code-status-line")).toHaveText("Code is read once the model has downloaded");
  await page.evaluate(() => window.__mock.emit("state", { model: { state: "ready" }, pending: 0 }));
  await expect(page.locator("#code-status-line")).toHaveText("Indexing code 36% · 300 of 812");
  await expect(page.locator("#code-bar")).toBeVisible();
  await page.evaluate(() => window.__mock.emit("state", { model: { state: "ready" }, pending: 20 }));
  await expect(page.locator("#code-status-line")).toHaveText("512 code files waiting · read after your other files");
});

// MARK: Storage and the model

test("Storage with the model in: Downloaded, no recovery", async ({ page }, testInfo) => {
  await open(page, { query: "?tab=storage" });
  await expect(page.locator("#model-status")).toHaveText("Downloaded");
  await expect(page.locator("#model-download")).toBeHidden();
  await expect(page.locator("#model-files")).toBeHidden();
  await expect(page.locator("#model-footer")).toBeHidden();
  await expect(page.locator("#index-size")).toHaveText("48 MB");
  await expect(page.locator("#code-index-size")).toHaveText("12 MB");
  await expect(page.locator("#version")).toHaveText(
    "DigUp 0.7.0 · EmbeddingGemma 2 by Google (Apache 2.0), run by llama.cpp (MIT).");
  await page.locator("#index-path").click();
  expect(await calls(page, "reveal")).toEqual([{ path: `${HOME}\\AppData\\Local\\DigUp\\Index` }]);
  await shot(page, testInfo, "settings-storage");
});

test("a stopped download: Download, Use Files… and Copy Links", async ({ page }, testInfo) => {
  const failed = { state: "failed", message: "the download stopped" };
  await open(page, { query: "?tab=storage", overrides: { state: { ...settingsInfo().state, model: failed } },
                     fx: { useFiles: { ok: false, message: "Those aren't the model's files" } } });
  await expect(page.locator("#model-status")).toHaveText("The download stopped");
  await expect(page.locator("#model-footer")).toBeVisible();
  await expect(page.locator("#model-footer .footnote")).toContainText("If your network blocks Hugging Face");
  await shot(page, testInfo, "settings-storage-model-failed");
  await page.locator("#model-download").click();
  expect(await calls(page, "retry_download")).toHaveLength(1);
  await page.locator("#model-files").click();
  expect(await calls(page, "use_model_files")).toHaveLength(1);
  await expect(page.locator("#problem-text")).toHaveText("Those aren't the model's files");
  await page.locator("#copy-links").click();
  await expect.poll(() => calls(page, "copy_text")).toEqual([{
    text: "https://huggingface.co/a.gguf\nhttps://huggingface.co/b.gguf" }]);
  expect(await calls(page, "model_links")).toHaveLength(1);
});

test("a download under way: its progress and time left, here and on Folders", async ({ page }, testInfo) => {
  const downloading = { state: "downloading", bytes: 420, total: 1000, secondsLeft: 130 };
  await open(page, { query: "?tab=storage", overrides: { state: { ...settingsInfo().state, model: downloading } } });
  await expect(page.locator("#model-status")).toHaveText("42% · about 2 min left");
  await expect(page.locator("#model-download")).toBeHidden();
  await expect(page.locator("#model-files")).toBeHidden();
  await expect(page.locator("#model-footer")).toBeVisible();
  await shot(page, testInfo, "settings-storage-model-downloading");
  await page.evaluate(() => window.__mock.emit("state", { files: 10, searchable: 4, pending: 6,
    model: { state: "downloading", bytes: 900, total: 1000, secondsLeft: 12 } }));
  await expect(page.locator("#model-status")).toHaveText("90% · less than a minute left");
  await page.getByRole("tab", { name: "Folders" }).click();
  await expect(page.locator("#status-detail")).toHaveText("4 of 10 files searchable · 6 waiting · model 90% · less than a minute left");
  await page.evaluate(() => window.__mock.emit("state", { model: { state: "waiting" } }));
  await page.getByRole("tab", { name: "Storage" }).click();
  await expect(page.locator("#model-status")).toHaveText("Waiting for the network…");
});

// MARK: Windows 11's look

test("over Mica the page leaves the backdrop showing", async ({ page }) => {
  await open(page, { backdrop: true });
  await expect(page.locator("html")).toHaveAttribute("data-backdrop", "");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
});

test("without a backdrop the window has a solid surface", async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});

test("the page fits the window: no sideways scrolling on any tab", async ({ page }) => {
  await page.setViewportSize({ width: 660, height: 620 });
  await open(page);
  for (const name of ["General", "Folders", "Code", "Storage"]) {
    await page.getByRole("tab", { name }).click();
    expect(await page.evaluate(() => document.getElementById("main").scrollWidth <= document.getElementById("main").clientWidth))
      .toBe(true);
  }
});

test("screenshots of every tab, with and without the backdrop, and wide", async ({ page }, testInfo) => {
  test.skip(!process.env.SHOTS, "screenshots only");
  await page.setViewportSize({ width: 660, height: 620 });
  for (const backdrop of [false, true]) {
    await open(page, { backdrop, overrides: { state: { ...settingsInfo().state, line: "Indexing 64% · 780 of 1,210",
      progress: 0.64 } } });
    for (const name of ["General", "Folders", "Code", "Storage"]) {
      await page.getByRole("tab", { name }).click();
      await page.waitForTimeout(300);
      await shot(page, testInfo, `settings-${name.toLowerCase()}-${backdrop ? "mica" : "solid"}`);
    }
  }
  await page.getByRole("tab", { name: "Folders" }).click();
  await page.locator("#add-folders").click();
  await page.waitForTimeout(300);
  await shot(page, testInfo, "settings-dialog-add-folders-mica");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 960, height: 640 });
  await page.waitForTimeout(300);
  await shot(page, testInfo, "settings-folders-wide-navigationview");
});
