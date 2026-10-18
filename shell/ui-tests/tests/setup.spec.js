// setup.html: the first launch's steps (Onboarding.swift), Choose Folders… later, and the Code Folders window
// (setup.html?code), with the shell's commands stood in for.
const { test, expect } = require("@playwright/test");
const { openPage, shot, calls } = require("./helpers");

// The setup window's size (main.rs: 720 × 600 inside its frame).
test.use({ viewport: { width: 720, height: 600 } });

const HOME = "C:\\Users\\Yass";
const ACCENT = ["#99ebff", "#60cdff", "#00a3e0", "#0078d4", "#005fb8", "#004a94", "#003a6e"];
const OFFERED = ["Documents", "Pictures", "Videos", "Music", "Desktop", "Downloads"].map((name) => `${HOME}\\${name}`);

// `digup estimate --json` as the shell hands it on: one answer a folder, with its subfolders, the helper's slashes.
function estimate(args) {
  const subfolder = (folder, name, files, seconds, extra = {}) => ({
    folder: `${folder}/${name}`, files, seconds, later_seconds: 0, bytes: 0, readable: true, ...extra,
  });
  const make = (folder) => {
    const name = folder.split("/").pop();
    const base = { folder, readable: true, calibrated: true, later_seconds: 0, bytes: 0, subfolders: [] };
    if (args.code) {
      return { ...base, files: { code: 1840 }, seconds: 210, bytes: 14e6,
               subfolders: ["digup", "notes-app", "dotfiles"].map((repo, index) =>
                 subfolder(folder, repo, { code: 600 - index * 100 }, 70 - index * 10, { bytes: 4e6 + index * 1e6 })) };
    }
    if (name === "Documents") {
      return { ...base, files: { pdf: 125, doc: 340 }, seconds: 260, later_seconds: 180,
               kind_seconds: { pdf: 120, doc: 140 },
               subfolders: ["Taxes", "Work", "School", "Recipes", "Manuals", "Letters", "Contracts", "Travel", "Old", "Misc"]
                 .map((sub, index) => subfolder(folder, sub, { pdf: 20 - index, doc: 30 - index }, 40 - index * 3)) };
    }
    if (name === "Pictures") {
      return { ...base, files: { screenshot: 136, image: 1104 }, seconds: 420, kind_seconds: { screenshot: 60, image: 360 },
               subfolders: [subfolder(folder, "Screenshots", { screenshot: 136 }, 60),
                            subfolder(folder, "Camera Roll", { image: 1104 }, 360)] };
    }
    if (name === "Videos") return { ...base, files: { video: 12 }, seconds: 95, kind_seconds: { video: 95 } };
    if (name === "Music") return { ...base, files: { audio: 48 }, seconds: 130, kind_seconds: { audio: 130 } };
    if (name === "Desktop") return { ...base, files: { screenshot: 14, pdf: 3 }, seconds: 12 };
    if (name === "Downloads") return { ...base, files: { pdf: 60, image: 40, doc: 12 }, seconds: 75 };
    return { ...base, files: { doc: 4 }, seconds: 3 };
  };
  return args.folders.map((folder) => make(folder.replaceAll("\\", "/")));
}

const MODEL = { state: "downloading", bytes: 365e6, total: 865e6, secondsLeft: 130 };

function setupInfo(overrides = {}) {
  return {
    offered: OFFERED, chosen: [], skipped: [], codeOffered: [`${HOME}\\Projects`], setUp: false,
    hotkey: "Ctrl+Alt+Space", shortcut: { method: "grab", command: "digup-shell --toggle" },
    model: MODEL, state: { activity: "indexing", indexing: { done: 420, total: 2210 }, searchable: 420 },
    auto: false, indexOnBattery: true, onBattery: false, ...overrides,
  };
}

const SETTINGS = {
  canOpenAtLogin: true, openAtLogin: false, skipTypes: [],
  code: { editors: [{ id: "vscode", name: "Visual Studio Code" }, { id: "cursor", name: "Cursor" }], editor: "vscode" },
};

function responses(overrides = {}) {
  return {
    system_look: { backdrop: false, accent: ACCENT },
    setup_info: setupInfo(),
    settings_info: SETTINGS,
    estimate,
    apply_setup_folders: null,
    set_code_folders: null,
    finish_setup: null,
    pick_folders: [],
    set_hotkey: (args) => args.hotkey,
    model_links: ["https://huggingface.co/ggml-org/a/resolve/r/model.gguf", "https://huggingface.co/ggml-org/a/resolve/r/mmproj.gguf"],
    use_model_files: { ok: false, message: "Those aren't the model's files" },
    file_icon: null,
    ...overrides,
  };
}

const step = (page, id) => expect(page.locator(`#${id}`)).toBeVisible();
const next = (page) => page.locator("#next").click();
const folderRow = (page, name) => page.locator("#folder-list .folder-box").filter({ has: page.locator(".folder .name", { hasText: new RegExp(`^${name}$`) }) });

test.describe("first launch", () => {
  test("walks every step forward and back with the mouse", async ({ page }, testInfo) => {
    await openPage(page, "setup.html", responses());
    await step(page, "welcome");
    await expect(page.locator("#next")).toHaveText("Get Started");
    await expect(page.locator("#back")).toBeHidden();
    await expect(page.locator("#pips span")).toHaveCount(5);
    await expect(page.locator("#pips span").nth(0)).toHaveClass("current");
    await expect(page.locator("#pips")).toHaveAttribute("aria-label", "Step 1 of 5");
    await expect(page.locator("#download")).toBeHidden();
    await shot(page, testInfo, "setup-1-welcome");

    await next(page);
    await step(page, "folders");
    await expect(page.locator("#folders-subtitle")).toContainText("Pick folders, or open one to pick some of its subfolders.");
    // The Mac's order, and every folder checked, Downloads too.
    await expect(page.locator("#folder-list .folder .name")).toHaveText(["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"]);
    for (const box of await page.locator("#folder-list .folder .f-check").all()) await expect(box).toBeChecked();
    // What's in them and how long the first pass takes.
    await expect(folderRow(page, "Pictures").locator(".counts")).toHaveAttribute("title", "136 screenshots, 1,104 images");
    await expect(folderRow(page, "Pictures").locator(".time")).toHaveText("≈ 7 min");
    await expect(folderRow(page, "Documents").locator(".time")).toContainText("+ 3 min later");
    await expect(page.locator("#summary")).toHaveText("First pass: about 17 min");
    await expect(page.locator("#download")).toContainText("Downloading the model · 42% · about 2 min left");
    await expect(page.locator("#pips span").nth(1)).toHaveClass("current");
    await shot(page, testInfo, "setup-2-folders");

    await next(page);
    await step(page, "code");
    await expect(page.locator("#code-scroll")).toBeHidden();
    await expect(page.locator("#summary")).toHaveText("");
    await page.locator("#code .switch-card").click();
    await expect(page.locator("#search-code")).toBeChecked();
    await expect(page.locator("#code-scroll")).toBeVisible();
    await expect(page.locator("#code-list .folder .name")).toHaveText(["Projects"]);
    await expect(page.locator("#summary")).toHaveText("About 4 min, 14 MB");
    await shot(page, testInfo, "setup-3-code");
    await page.locator("#back").click();
    await step(page, "folders");
    await next(page);
    await step(page, "code");
    await expect(page.locator("#search-code")).toBeChecked();

    await next(page);
    await step(page, "shortcut");
    await expect(page.locator("#keys .key")).toHaveText(["Ctrl", "Alt", "Space"]);
    await expect(page.locator("#try")).toHaveText("Try it now: press Ctrl+Alt+Space.");
    await shot(page, testInfo, "setup-4-shortcut");

    await next(page);
    await step(page, "ready");
    await expect(page.locator("#back")).toBeHidden();
    await expect(page.locator("#next")).toHaveText("Done");
    await expect(page.locator("#progress-what")).toHaveText("Downloading the model");
    await shot(page, testInfo, "setup-5-ready");

    await next(page);
    expect(await calls(page, "apply_setup_folders")).toEqual([{ folders: [
      `${HOME}\\Desktop`, `${HOME}\\Documents`, `${HOME}\\Downloads`, `${HOME}\\Pictures`, `${HOME}\\Videos`, `${HOME}\\Music`,
    ], skipped: [] }, expect.anything()]);
    expect(await calls(page, "set_code_folders")).toEqual([{ folders: [`${HOME}\\Projects`], skipped: [] }]);
    expect(await calls(page, "finish_setup")).toEqual([{ openAtLogin: true, indexOnBattery: true }]);
  });

  test("walks the steps with the keyboard", async ({ page }) => {
    await openPage(page, "setup.html", responses({ setup_info: setupInfo({ codeOffered: [] }) }));
    await step(page, "welcome");
    await page.keyboard.press("Enter");
    await step(page, "folders");
    await expect(page.locator("#pips span")).toHaveCount(4);
    // Tab to the first folder's checkbox; Space unchecks it and the keyboard stays there.
    await expect(page.locator("#summary")).toHaveText(/First pass/);
    await page.locator('#folder-list [data-focus^="check:"]').first().focus();
    await page.keyboard.press("Space");
    await expect(folderRow(page, "Desktop").locator(".f-check")).not.toBeChecked();
    await expect(page.locator('#folder-list [data-focus^="check:"]').first()).toBeFocused();
    // → opens a folder to its subfolders, ← closes it.
    const documents = folderRow(page, "Documents");
    await documents.locator(".f-check").focus();
    await page.keyboard.press("ArrowRight");
    await expect(documents.locator(".subfolder")).toHaveCount(8);
    await expect(documents.locator(".more")).toHaveText("Show 2 more");
    await expect(documents.locator(".folder .f-check")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(documents.locator(".subfolder")).toHaveCount(0);
    // Enter on a checkbox is the default button.
    await page.keyboard.press("Enter");
    await step(page, "shortcut");
    await page.keyboard.press("Enter");
    await step(page, "ready");
    await page.keyboard.press("Enter");
    await expect.poll(() => calls(page, "finish_setup")).toEqual([{ openAtLogin: true, indexOnBattery: true }]);
    const applied = await calls(page, "apply_setup_folders");
    expect(applied[0].folders).not.toContain(`${HOME}\\Desktop`);
  });

  test("Back goes back a step and the pips follow", async ({ page }) => {
    await openPage(page, "setup.html", responses());
    await next(page);
    await next(page);
    await step(page, "code");
    await expect(page.locator("#pips span").nth(2)).toHaveClass("current");
    await page.locator("#back").click();
    await step(page, "folders");
    await page.locator("#back").click();
    await step(page, "welcome");
    await expect(page.locator("#back")).toBeHidden();
  });

  test("folders: choosing some subfolders, skipping one deeper, and file types", async ({ page }, testInfo) => {
    await openPage(page, "setup.html", responses({
      pick_folders: (args) => (args.title === "Skip Folders" ? ["C:\\Users\\Yass\\Downloads\\Installers\\Old"] : []),
      set_skip_types: (args) => args.types.split(", "),
    }));
    await next(page);
    const documents = folderRow(page, "Documents");
    await documents.locator(".disclosure").click();
    await expect(documents.locator(".disclosure")).toHaveAttribute("aria-expanded", "true");
    await documents.locator(".more").click();
    await expect(documents.locator(".subfolder")).toHaveCount(10);
    await documents.locator(".subfolder", { hasText: "Taxes" }).click();
    await expect(documents.locator(".folder .f-check")).toHaveJSProperty("indeterminate", true);
    // Unchecking Pictures whole, then checking one of its subfolders back.
    const pictures = folderRow(page, "Pictures");
    await pictures.locator(".folder .f-check").click();
    await expect(pictures).toHaveClass(/off/);
    await pictures.locator(".disclosure").click();
    await pictures.locator(".subfolder .f-check").first().click();
    await expect(pictures.locator(".folder .f-check")).toHaveJSProperty("indeterminate", true);

    // Skip some folders or file types: folded away until opened (nothing set yet).
    await expect(page.locator("#skips-body")).toBeHidden();
    await page.locator("#skips-toggle").click();
    await expect(page.locator("#skipped-list li")).toHaveText([`${HOME}\\Documents\\Taxes`]);
    await page.locator("#skip-folder").click();
    await expect(page.locator("#skipped-list li")).toHaveCount(2);
    await expect(page.locator("#skipped-list li").nth(1)).toContainText("Installers\\Old");
    await page.locator("#skip-types").fill("heic, .TXT");
    await page.locator("#skip-types").press("Enter");
    await expect(page.locator("#folders")).toBeVisible();   // Enter in the field applies the types; it doesn't continue
    const typed = (await calls(page, "estimate")).filter((args) => args.types?.length);
    expect(typed.at(-1).types).toEqual(["heic", "txt"]);
    expect(typed.at(-1).excluded).toEqual([`${HOME}\\Downloads\\Installers\\Old`]);
    await shot(page, testInfo, "setup-2b-folders-skips");
    // "Search this folder again".
    await page.locator("#skipped-list li").nth(1).locator(".unskip").click();
    await expect(page.locator("#skipped-list li")).toHaveCount(1);

    await next(page);
    expect(await calls(page, "set_skip_types")).toEqual([{ types: "heic, txt" }]);
    const [applied] = await calls(page, "apply_setup_folders");
    expect(applied.skipped).toEqual([`${HOME}\\Documents\\Taxes`]);
    expect(applied.folders).toContain(`${HOME}\\Pictures\\Screenshots`);
    expect(applied.folders).not.toContain(`${HOME}\\Pictures`);
  });

  test("folders: Add Folder… lists a new folder, or says it's searched already", async ({ page }) => {
    let picks = [["D:\\Scans"], ["C:\\Users\\Yass\\Music\\Live\\2019"]];
    await openPage(page, "setup.html", responses({ pick_folders: `fn:return window.__picks.shift() || []` }),
                   { setup: `window.__picks = ${JSON.stringify(picks)};` });
    await next(page);
    await page.locator("#folder-list .add-folder").click();
    await expect(page.locator("#folder-list .folder .name")).toHaveText(["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music", "Scans"]);
    await expect(folderRow(page, "Scans").locator(".f-check")).toBeChecked();
    await page.locator("#folder-list .add-folder").click();
    await expect(page.locator(".list-note")).toHaveText("“2019” is searched already, as part of “Music”.");
  });

  test("Continue waits for at least one folder", async ({ page }) => {
    await openPage(page, "setup.html", responses({ setup_info: setupInfo({ offered: [OFFERED[0]], codeOffered: [] }) }));
    await next(page);
    await folderRow(page, "Documents").locator(".folder .f-check").click();
    await expect(page.locator("#summary")).toHaveText("Choose at least one folder");
    await expect(page.locator("#next")).toBeDisabled();
  });

  test("code: off unless turned on, and the editor results open in", async ({ page }) => {
    await openPage(page, "setup.html", responses({ set_code_editor: null }));
    await next(page);
    await next(page);
    await step(page, "code");
    await expect(page.locator("#search-code")).not.toBeChecked();
    await expect(page.locator("#search-code-state")).toHaveText("Off");
    await page.locator("#search-code").check();
    await expect(page.locator("#search-code-state")).toHaveText("On");
    await expect(page.locator("#editor option")).toHaveText(["Visual Studio Code", "Cursor", "The file's default app"]);
    await expect(page.locator("#editor")).toHaveValue("vscode");
    await page.locator("#editor").selectOption("default");
    expect(await calls(page, "set_code_editor")).toEqual([{ editor: "default" }]);
    // A folder opens to its repositories, each with its time and size.
    const projects = page.locator("#code-list .folder-box");
    await expect(projects.locator(".time")).toHaveText("≈ 4 min14 MB");
    await projects.locator(".disclosure").click();
    await expect(projects.locator(".subfolder")).toHaveCount(3);
    await expect(projects.locator(".subfolder").first().locator(".time")).toHaveText("≈ 70 s · 4 MB");
    await projects.locator(".subfolder", { hasText: "dotfiles" }).click();
    await page.locator("#search-code").uncheck();
    await next(page);
    expect(await calls(page, "set_code_folders")).toEqual([]);
  });

  test("shortcut: pressing it says it works; the tips", async ({ page }, testInfo) => {
    await openPage(page, "setup.html", responses());
    await page.evaluate(() => window.__mock.emit("shortcut-pressed"));   // not on the shortcut step: nothing
    for (let i = 0; i < 3; i++) await next(page);
    await step(page, "shortcut");
    await expect(page.locator("#try")).toHaveText("Try it now: press Ctrl+Alt+Space.");
    await expect(page.locator("#tips dd")).toHaveText(["Open the file", "Show it in File Explorer",
      "Preview it, after arrowing to a result", "Copy the file, to paste anywhere", "Close"]);
    await expect(page.locator("#tips dt").nth(3).locator(".key")).toHaveText(["Ctrl", "C"]);
    await page.evaluate(() => window.__mock.emit("shortcut-pressed"));
    await expect(page.locator("#try")).toHaveText("That's it. It works from any app.");
    await expect(page.locator("#try")).toHaveClass(/worked/);
    await shot(page, testInfo, "setup-4b-shortcut-worked");
  });

  test("shortcut: the recorder takes a new one", async ({ page }) => {
    await openPage(page, "setup.html", responses());
    for (let i = 0; i < 3; i++) await next(page);
    await page.locator("#recorder").click();
    await expect(page.locator("#recorder")).toHaveText("Press the new shortcut…");
    await expect(page.locator("#recorder-caption")).toHaveText("Esc cancels");
    expect(await calls(page, "hold_hotkey")).toEqual([{ held: true }]);
    await page.keyboard.press("k");
    await expect(page.locator("#recorder-caption")).toHaveText(/Add Ctrl, Alt or the Windows key/);
    await page.keyboard.press("Control+Shift+K");
    await expect(page.locator("#keys .key")).toHaveText(["Ctrl", "Shift", "K"]);
    await expect(page.locator("#try")).toHaveText("Try it now: press Ctrl+Shift+K.");
    expect(await calls(page, "set_hotkey")).toEqual([{ hotkey: "Ctrl+Shift+K" }]);
    expect(await calls(page, "hold_hotkey")).toEqual([{ held: true }, { held: false }]);
    // Esc keeps the one there is (and doesn't leave the step).
    await page.locator("#recorder").click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#keys .key")).toHaveText(["Ctrl", "Shift", "K"]);
    await step(page, "shortcut");
    // Enter while it listens is a key without Ctrl, not Continue; a second click stops listening.
    await page.locator("#recorder").click();
    await page.keyboard.press("Enter");
    await step(page, "shortcut");
    await page.locator("#recorder").click();
    await expect(page.locator("#recorder-caption")).toHaveText("Click to change");
    expect((await calls(page, "hold_hotkey")).at(-1)).toEqual({ held: false });
  });

  test("shortcut: a desktop that keeps it itself says where", async ({ page }) => {
    await openPage(page, "setup.html", responses({
      setup_info: setupInfo({ codeOffered: [], shortcut: { method: "gnome", command: "digup-shell --toggle" } }),
    }), { platform: "Linux x86_64" });
    for (let i = 0; i < 2; i++) await next(page);
    await step(page, "shortcut");
    await expect(page.locator("#recorder")).toBeDisabled();
    await expect(page.locator("#shortcut-note")).toContainText("GNOME's keyboard shortcuts");
    await expect(page.locator("#tips dd").nth(1)).toHaveText("Show it in its folder");
  });

  test("ready: the two switches go to finish_setup", async ({ page }) => {
    await openPage(page, "setup.html", responses({ setup_info: setupInfo({ codeOffered: [], indexOnBattery: true }) }));
    await page.goto(page.url() + "?page=ready");
    await step(page, "ready");
    await expect(page.locator("#login")).toBeChecked();
    await expect(page.locator("#battery")).toBeChecked();
    await page.locator("#login-row").click();
    await page.locator("#battery").uncheck();
    await expect(page.locator("#login-state")).toHaveText("Off");
    await expect(page.locator("#battery-state")).toHaveText("Off");
    await next(page);
    expect(await calls(page, "finish_setup")).toEqual([{ openAtLogin: false, indexOnBattery: false }]);
  });

  test("ready: without login at hand, only the battery choice is passed", async ({ page }) => {
    await openPage(page, "setup.html", responses({ settings_info: { ...SETTINGS, canOpenAtLogin: false },
                                                   setup_info: setupInfo({ codeOffered: [] }) }));
    await page.goto(page.url() + "?page=ready");
    await expect(page.locator("#login-row")).toBeHidden();
    await next(page);
    expect(await calls(page, "finish_setup")).toEqual([{ indexOnBattery: true }]);
  });

  test("the download failing: Try Again, Use Files…, Copy Links", async ({ page }, testInfo) => {
    const failed = { state: "failed", message: "Needs 1.1 GB free on this disk" };
    await openPage(page, "setup.html", responses({ setup_info: setupInfo({ model: failed, codeOffered: [] }) }));
    await next(page);
    const footer = page.locator("#download");
    await expect(footer).toContainText("Needs 1.1 GB free on this disk");
    await shot(page, testInfo, "setup-2c-folders-download-failed");
    await footer.getByRole("button", { name: "Use Files…" }).click();
    expect(await calls(page, "use_model_files")).toEqual([{}]);
    await expect(footer).toContainText("Those aren't the model's files");
    await footer.getByRole("button", { name: "Try Again" }).click();
    expect(await calls(page, "retry_download")).toEqual([{}]);
    await expect(footer).toContainText("Downloading the model · Checking the download…");
    await page.evaluate((failed) => window.__mock.emit("model", failed), failed);
    await next(page);
    await next(page);
    await step(page, "ready");
    const problem = page.locator("#model-problem");
    await expect(problem).toBeVisible();
    await expect(problem).toContainText("The model couldn't download (Needs 1.1 GB free on this disk).");
    await shot(page, testInfo, "setup-5b-ready-download-failed");
    await problem.getByRole("button", { name: "Copy Links" }).click();
    await expect(problem.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await calls(page, "model_links")).toEqual([{}]);
    expect(await calls(page, "copy_text")).toEqual([{ text: "https://huggingface.co/ggml-org/a/resolve/r/model.gguf\n"
      + "https://huggingface.co/ggml-org/a/resolve/r/mmproj.gguf" }]);
    await problem.getByRole("button", { name: "Try Again" }).click();
    expect(await calls(page, "retry_download")).toHaveLength(2);
    await page.evaluate(() => window.__mock.emit("model", { state: "ready" }));
    await expect(problem).toBeHidden();
  });

  test("the model ready shows in the footer", async ({ page }) => {
    await openPage(page, "setup.html", responses({ setup_info: setupInfo({ model: { state: "ready" } }) }));
    await next(page);
    await expect(page.locator("#download")).toHaveText("Model ready");
  });

  test("the shell's icons replace the folder glyph", async ({ page }) => {
    const icon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await openPage(page, "setup.html", responses({ file_icon: icon }));
    await next(page);
    await expect(folderRow(page, "Desktop").locator(".folder-icon")).toHaveAttribute("src", icon);
    const asked = await calls(page, "file_icon");
    expect(asked).toContainEqual({ path: `${HOME}\\Desktop`, size: 32 });
  });
});

test.describe("later windows", () => {
  test("Choose Folders…: Save once something changes, Cancel and Esc close", async ({ page }, testInfo) => {
    await openPage(page, "setup.html", responses({
      setup_info: setupInfo({ setUp: true, chosen: [`${HOME}\\Documents`, `${HOME}\\Pictures`], codeOffered: [] }),
    }));
    await step(page, "folders");
    await expect(page.locator("#pips")).toBeHidden();
    await expect(page.locator("#download")).toBeHidden();
    await expect(page.locator("#skips")).toBeHidden();
    await expect(page.locator("#back")).toHaveText("Cancel");
    await expect(page.locator("#next")).toHaveText("Save");
    await expect(page.locator("#next")).toBeDisabled();
    await expect(folderRow(page, "Desktop").locator(".f-check")).not.toBeChecked();
    await folderRow(page, "Desktop").locator(".folder").click();
    await expect(page.locator("#next")).toBeEnabled();
    await shot(page, testInfo, "setup-6-choose-folders");
    await page.keyboard.press("Escape");
    expect(await calls(page, "close_window")).toHaveLength(1);
    await next(page);
    expect((await calls(page, "apply_setup_folders"))[0].folders).toEqual([`${HOME}\\Documents`, `${HOME}\\Pictures`, `${HOME}\\Desktop`]);
    expect(await calls(page, "close_window")).toHaveLength(2);
  });

  test("Code Folders: the code folders, their repos, and Save", async ({ page }, testInfo) => {
    await openPage(page, "setup.html?code", responses({
      code_setup_info: { code: true, setUp: true, offered: [`${HOME}\\Projects`, `${HOME}\\Source`],
                         chosen: [`${HOME}\\Projects`], skipped: [] },
    }));
    await step(page, "folders");
    await expect(page).toHaveTitle("Code Folders");
    await expect(page.locator("#folders-title")).toHaveText("Search your code");
    await expect(page.locator("#code-folder-note")).toBeVisible();
    await expect(page.locator("#folder-list .add-folder")).toHaveText("Choose Another Folder…");
    await expect(page.locator("#summary")).toHaveText("About 4 min, 14 MB");
    await expect(page.locator("#next")).toBeDisabled();
    expect((await calls(page, "estimate"))[0]).toMatchObject({ code: true });
    const projects = folderRow(page, "Projects");
    await projects.locator(".disclosure").click();
    await projects.locator(".subfolder", { hasText: "dotfiles" }).locator(".f-check").click();
    await expect(projects.locator(".folder .f-check")).toHaveJSProperty("indeterminate", true);
    await folderRow(page, "Source").locator(".folder .f-check").click();
    await expect(page.locator("#next")).toBeEnabled();
    await shot(page, testInfo, "setup-7-code-folders");
    await next(page);
    expect(await calls(page, "set_code_folders")).toEqual([{
      folders: [`${HOME}\\Projects`, `${HOME}\\Source`], skipped: [`${HOME}\\Projects\\dotfiles`],
    }]);
    expect(await calls(page, "close_window")).toHaveLength(1);
  });

  test("Code Folders: unchecking everything turns code search off", async ({ page }) => {
    await openPage(page, "setup.html?code", responses({
      code_setup_info: { code: true, setUp: true, offered: [`${HOME}\\Projects`], chosen: [`${HOME}\\Projects`], skipped: [] },
    }));
    await folderRow(page, "Projects").locator(".folder .f-check").click();
    await expect(page.locator("#summary")).toHaveText("Code search turns off");
    await next(page);
    expect(await calls(page, "set_code_folders")).toEqual([{ folders: [], skipped: [] }]);
  });
});

// Every step and both later windows over Mica (a stand-in tint behind the transparent page) and on a solid surface.
for (const backdrop of [true, false]) {
  const tag = backdrop ? "mica" : "solid";
  const open = async (page, testInfo, file, extra = {}) => {
    await openPage(page, file, responses({ system_look: { backdrop, accent: ACCENT }, ...extra }));
    if (!backdrop) return;
    await expect(page.locator("html")).toHaveAttribute("data-backdrop", "");
    const tint = testInfo.project.name === "dark" ? "linear-gradient(160deg, #1d2128, #23201f)"
                                                  : "linear-gradient(160deg, #eef1f6, #f6f0ee)";
    await page.addStyleTag({ content: `html { background: ${tint} !important; }` });
  };

  test.describe(`screenshots, backdrop ${backdrop ? "on" : "off"}`, () => {
    test.skip(!process.env.SHOTS, "SHOTS=1 writes the screenshots");

    test("every step", async ({ page }, testInfo) => {
      await open(page, testInfo, "setup.html");
      await shot(page, testInfo, `setup-${tag}-1-welcome`);
      await next(page);
      await expect(page.locator("#summary")).toHaveText(/First pass/);
      await folderRow(page, "Documents").locator(".disclosure").click();
      await shot(page, testInfo, `setup-${tag}-2-folders`);
      await page.locator("#skips-toggle").click();
      await page.locator("#folders-scroll").evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await shot(page, testInfo, `setup-${tag}-2b-folders-skips`);
      await next(page);
      await shot(page, testInfo, `setup-${tag}-3-code-off`);
      await page.locator("#search-code").check();
      await page.locator("#code-list .disclosure").click();
      await shot(page, testInfo, `setup-${tag}-3b-code`);
      await next(page);
      await shot(page, testInfo, `setup-${tag}-4-shortcut`);
      await page.evaluate(() => window.__mock.emit("shortcut-pressed"));
      await page.waitForTimeout(300);   // its fade-in
      await shot(page, testInfo, `setup-${tag}-4b-shortcut-worked`);
      await next(page);
      await shot(page, testInfo, `setup-${tag}-5-ready`);
      await page.evaluate(() => window.__mock.emit("model", { state: "failed", message: "the download stopped" }));
      await shot(page, testInfo, `setup-${tag}-5b-ready-failed`);
    });

    test("Code Folders", async ({ page }, testInfo) => {
      await open(page, testInfo, "setup.html?code", { code_setup_info: { code: true, setUp: true,
        offered: [`${HOME}\\Projects`, `${HOME}\\Source`], chosen: [`${HOME}\\Projects`], skipped: [] } });
      await folderRow(page, "Projects").locator(".disclosure").click();
      await shot(page, testInfo, `setup-${tag}-7-code-folders`);
    });

    test("Choose Folders", async ({ page }, testInfo) => {
      await open(page, testInfo, "setup.html", { setup_info: setupInfo({ setUp: true, chosen: [`${HOME}\\Documents`] }) });
      await expect(page.locator("#folder-list .time").first()).toBeVisible();
      await shot(page, testInfo, `setup-${tag}-6-choose-folders`);
    });
  });
}
