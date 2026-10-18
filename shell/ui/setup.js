// DigUp's setup window, as the Mac app's onboarding (Onboarding.swift): what DigUp does, which folders to search (with
// how long the first pass takes), code search when there's code here, the shortcut (try it), and done, with step pips
// and the model's download along the bottom. Folders show what's in them and how long their first pass takes
// (`digup estimate`; the times once the helper has timed this computer with the model), and open to their subfolders
// (FolderChoices.swift). Indexing starts as the folders step is left; the last step shows it going (the download, then
// the files, with the time left) until Done opens the window. Choose Folders… later is the folders step alone, with
// Save. `?code`: the Code Folders window (Settings → Code, AddFolders.swift's code sheet): folders with code, each with
// the time its code takes to read and its index's size, open to their repositories.
"use strict";

const tauri = window.__TAURI__;
const invoke = (command, args) => tauri.core.invoke(command, args);
const isMac = /Mac/.test(navigator.platform);
const isWindows = /Win/.test(navigator.platform);
// A first launch that finds code in the home folder also asks about code search, after the folders (`code`).
let PAGES = ["welcome", "folders", "shortcut", "ready"];
const SHORT_LIST = 8;   // subfolders shown before "Show N more" (FolderRow.shortList)
const codeMode = new URLSearchParams(location.search).has("code");

const $ = (id) => document.getElementById(id);
let page = 0;
let firstTime = true;
let info = { offered: [], chosen: [], skipped: [], hotkey: "", model: { state: "checking" }, state: {}, auto: false };
// Settings' answers setup uses too: the editors, the file types skipped, whether DigUp can open at login.
let settings = {};

const CHEVRON = '<svg class="chevron" viewBox="0 0 16 16"><path d="M6 3.5 L10.5 8 L6 12.5"/></svg>';
const PLUS = '<svg class="glyph" viewBox="0 0 16 16"><path d="M8 3 V13 M3 8 H13"/></svg>';
const INFO = '<svg class="glyph" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.2 V11.2 M8 4.8 V5"/></svg>';
const MINUS = '<svg class="glyph" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5"/><path d="M5.2 8 H10.8"/></svg>';
const CHECK = '<svg class="state-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.2 L7 10.4 L11.2 6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const WARNING = '<svg class="state-icon" viewBox="0 0 16 16"><path d="M8 1.6 L15 14 H1 Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 6 V9.6 M8 11.6 V11.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>';
const DOWN = '<svg class="state-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 4.6 V11 M5.4 8.6 L8 11.2 L10.6 8.6"/></svg>';
// The folder glyph where the shell has no icon to give (Linux, or before it comes): Windows 11's yellow folder.
const FOLDER = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
  + '<path d="M3 8.5 A2.5 2.5 0 0 1 5.5 6 H12 L15 9 H26.5 A2.5 2.5 0 0 1 29 11.5 V12 H3 Z" fill="#e0a526"/>'
  + '<path d="M3 11 H29 V24.5 A2.5 2.5 0 0 1 26.5 27 H5.5 A2.5 2.5 0 0 1 3 24.5 Z" fill="#ffc83d"/></svg>');
// The kinds' glyphs (results.js's), in FileKind's order.
const KINDS = {
  screenshot: '<path d="M4 8 V4 H8 M16 4 H20 V8 M20 16 V20 H16 M8 20 H4 V16 M9 12 A3 3 0 1 0 15 12 A3 3 0 1 0 9 12"/>',
  image: '<path d="M4 5 H20 V19 H4 Z M4 16 L9 11 L13 15 L16 12 L20 16"/>',
  pdf: '<path d="M6 3 H14 L19 8 V21 H6 Z M14 3 V8 H19 M9 13 H16 M9 16 H14"/>',
  doc: '<path d="M6 3 H14 L19 8 V21 H6 Z M14 3 V8 H19 M9 12 H16 M9 15 H16 M9 18 H13"/>',
  audio: '<path d="M3 12 H5 M7 8 V16 M10 5 V19 M13 9 V15 M16 6 V18 M19 10 V14 M21 12 H22"/>',
  video: '<path d="M4 6 H15 V18 H4 Z M15 10 L20 7 V17 L15 14"/>',
  code: '<path d="M9 7 L4 12 L9 17 M15 7 L20 12 L15 17"/>',
};
// "1 screenshot", "25 PDFs", "6 audio files" (Components.swift's FileKind.counted).
const NOUNS = {
  screenshot: ["screenshot", "screenshots"], image: ["image", "images"], pdf: ["PDF", "PDFs"],
  doc: ["document", "documents"], audio: ["audio file", "audio files"], video: ["video", "videos"],
  code: ["code file", "code files"],
};

// MARK: Paths
// The helper reports folders with forward slashes; on Windows the shell gives them with backslashes, and case doesn't
// matter. Folders are kept as the helper spells them and handed back as the system does.

// A drive keeps its slash: "C:" alone is the folder Windows was last in on drive C, not the drive.
function canon(path) {
  return (path || "").replaceAll("\\", "/").replace(/(.)\/+$/, "$1").replace(/^([A-Za-z]:)$/, "$1/");
}
function key(path) { return isWindows ? canon(path).toLowerCase() : canon(path); }
function same(a, b) { return key(a) === key(b); }
function inside(path, folder) {
  const k = key(folder), p = key(path);
  return p !== k && p.startsWith(k.endsWith("/") ? k : k + "/");
}
function parentOf(path) { const c = canon(path); return canon(c.slice(0, c.lastIndexOf("/"))) || c; }
function native(path) { return isWindows ? canon(path).replaceAll("/", "\\") : canon(path); }
function nameOf(path) { return canon(path).split("/").filter(Boolean).pop() || path; }
function unique(paths) { return paths.filter((path, index) => paths.findIndex((other) => same(other, path)) === index); }

// MARK: The selection (the engine's FolderSelection): chosen folders, minus the folders skipped inside them

class Selection {
  constructor(chosen = [], skipped = []) {
    this.chosen = unique(chosen.map(canon));
    this.skipped = unique(skipped.map(canon));
  }
  isSearched(path) {
    return this.chosen.some((folder) => (same(path, folder) || inside(path, folder))
      && !this.skipped.some((skip) => inside(skip, folder) && (same(path, skip) || inside(path, skip))));
  }
  /// The closest chosen folder that searches `path`.
  searchedAs(path) {
    return this.chosen.filter((folder) => (same(path, folder) || inside(path, folder))
      && !this.skipped.some((skip) => inside(skip, folder) && (same(path, skip) || inside(path, skip))))
      .sort((a, b) => b.length - a.length)[0] || null;
  }
  /// A folder's checkbox: mixed when some of its subfolders are skipped (it's searched) or chosen (it isn't).
  mark(folder) {
    if (this.isSearched(folder)) {
      return this.skipped.some((skip) => same(parentOf(skip), folder) && !this.isSearched(skip)) ? "mixed" : "on";
    }
    return this.chosen.some((chosen) => same(parentOf(chosen), folder)) ? "mixed" : "off";
  }
  /// A folder and its subfolders: all of it, or none of it.
  setFolder(folder, on) {
    this.skipped = this.skipped.filter((skip) => !same(parentOf(skip), folder));
    this.chosen = this.chosen.filter((chosen) => !same(parentOf(chosen), folder));
    this.setSubfolder(folder, on);
  }
  /// One folder, leaving the choices inside it as they are.
  setSubfolder(folder, on) {
    folder = canon(folder);
    if (on) {
      this.skipped = this.skipped.filter((skip) => !same(skip, folder));
      if (!this.isSearched(folder)) this.chosen.push(folder);
    } else {
      this.chosen = this.chosen.filter((chosen) => !same(chosen, folder));
      if (this.isSearched(folder)) this.skipped.push(folder);
    }
  }
  /// Stops skipping `folder` (without choosing it).
  unskip(folder) { this.skipped = this.skipped.filter((skip) => !same(skip, folder)); }
  /// What the indexer gets: the chosen folders, without those another one already searches whole.
  folders() {
    const all = unique(this.chosen);
    return all.filter((folder) => !all.some((other) => !same(other, folder) && inside(folder, other)
      && !this.skipped.some((skip) => inside(skip, other) && (same(folder, skip) || inside(folder, skip)))));
  }
  /// The skips that leave something out (inside a folder that's searched).
  skips() {
    const folders = this.folders();
    return unique(this.skipped).filter((skip) => folders.some((folder) => inside(skip, folder)));
  }
}

// MARK: Folder lists (FolderChoices.swift): the folders with what's in them and how long their first pass takes, each
// opening to its subfolders. Nothing applies here: Continue and Save hand over `roots()` and `skips()`.

const icons = new Map();   // a folder's icon from the shell (`file_icon`), by key and size: a data URL, or null

class FolderChoices {
  constructor({ list, rows, chosen, skipped, types = [], code = false, addTitle }) {
    this.list = list;
    this.rows = [];
    for (const row of rows) this.addRow(row);
    this.selection = new Selection(chosen, skipped);
    this.initial = { folders: this.selection.folders().map(key).sort(), skips: this.selection.skips().map(key).sort() };
    this.types = types;
    this.code = code;
    this.addTitle = addTitle;
    this.estimates = new Map();   // key(folder) → the helper's estimate of it
    this.runs = new Map();        // key(folder) → the estimate run its answer must come from
    this.run = 0;
    this.open = new Set();        // key(folder) of folders showing their subfolders
    this.showAll = new Set();     // … showing all of them
    this.note = null;             // what became of the folders picked last, when it wasn't what was asked
    this.calibrated = false;      // the times are this computer's (timed with the model, or measured by indexing)
    this.onChange = () => {};
    // A folder with some of its subfolders chosen or skipped starts open, so it shows which.
    for (const row of this.rows) {
      if ([...this.selection.chosen, ...this.selection.skipped].some((path) => same(parentOf(path), row))) this.open.add(key(row));
    }
  }

  addRow(path) {
    if (!this.rows.some((row) => same(row, path))) this.rows.push(canon(path));
  }

  /// Estimates the rows that have none yet.
  startEstimates() { this.estimate(this.rows.filter((row) => !this.runs.has(key(row)))); }
  estimatesDone() { return this.rows.every((row) => this.estimates.has(key(row))); }

  /// The helper's look at these folders (one answer per folder, with its subfolders). Skipped subfolders of a listed
  /// folder still count there (the list shows them, unchecked); deeper skips are left out, and the file types skipped.
  async estimate(paths) {
    if (!paths.length) return;
    const run = ++this.run;
    for (const path of paths) {
      this.runs.set(key(path), run);
      this.estimates.delete(key(path));
    }
    this.render();
    const excluded = this.selection.skipped.filter((skip) => !this.rows.some((row) => same(row, parentOf(skip))));
    let answers = [];
    try {
      answers = await invoke("estimate", { folders: paths.map(native), code: this.code, excluded: excluded.map(native),
                                           types: this.types }) || [];
    } catch {
      // Each folder shows that it couldn't be looked into.
    }
    for (const answer of answers) {
      if (this.runs.get(key(answer.folder)) !== run) continue;
      this.estimates.set(key(answer.folder), answer);
      if (answer.readable !== false) this.calibrated = answer.calibrated !== false;
    }
    for (const path of paths) {
      if (this.runs.get(key(path)) === run && !this.estimates.has(key(path))) {
        this.estimates.set(key(path), { folder: path, failed: true, files: {}, seconds: 0 });
      }
    }
    this.render();
  }

  // Checkboxes

  toggle(row) {
    this.note = null;
    this.selection.setFolder(row, this.selection.mark(row) !== "on");
    this.render();
  }
  toggleSubfolder(path) {
    this.note = null;
    this.selection.setSubfolder(path, !this.selection.isSearched(path));
    this.render();
  }
  setOpen(row, on) {
    if (on) this.open.add(key(row)); else this.open.delete(key(row));
    this.render();
  }

  // Folders picked in the system's folder picker

  /// Add Folder…: a folder that's listed (or a subfolder of one, which opens) gets checked; any other is listed as a
  /// new folder, checked, unless it's searched already (a note says as part of what).
  add(picked) {
    this.note = null;
    const fresh = [];
    for (const path of picked.map(canon)) {
      const parent = this.rows.find((row) => same(row, parentOf(path)));
      if (this.rows.some((row) => same(row, path))) {
        this.selection.setFolder(path, true);
      } else if (parent) {
        this.selection.setSubfolder(path, true);
        this.open.add(key(parent));
      } else if (this.selection.isSearched(path)) {
        const by = this.selection.searchedAs(path);
        this.note = `“${nameOf(path)}” is searched already` + (!by || same(by, path) ? "." : `, as part of “${nameOf(by)}”.`);
      } else {
        this.addRow(path);
        this.selection.setFolder(path, true);
        fresh.push(path);
      }
    }
    this.render();
    this.estimate(fresh);
  }

  /// Skip a Folder…: a folder that's listed (or a subfolder of one, which opens) gets unchecked; one deeper is skipped
  /// inside the folders that search it, whose estimates run again.
  skip(picked) {
    this.note = null;
    const deeper = [];
    for (const path of picked.map(canon)) {
      const parent = this.rows.find((row) => same(row, parentOf(path)));
      if (this.rows.some((row) => same(row, path))) {
        this.selection.setFolder(path, false);
      } else if (parent) {
        this.selection.setSubfolder(path, false);
        this.open.add(key(parent));
      } else if (this.selection.isSearched(path)) {
        this.selection.setSubfolder(path, false);
        deeper.push(path);
      } else {
        this.note = `“${nameOf(path)}” isn't searched anyway.`;
      }
    }
    this.render();
    this.estimate(this.rows.filter((row) => deeper.some((path) => inside(path, row))));
  }

  unskip(path) {
    this.note = null;
    this.selection.unskip(path);
    this.render();
    if (!this.rows.some((row) => same(row, parentOf(path)))) this.estimate(this.rows.filter((row) => inside(path, row)));
  }

  /// File types to skip, as typed ("heic, .txt"); every estimate runs again when they change.
  setTypes(text) {
    const types = [...new Set(text.split(/[\s,]+/).map((type) => type.trim().replace(/^\.+/, "").toLowerCase())
      .filter(Boolean))].sort();
    if (types.join() === this.types.join()) return false;
    this.types = types;
    this.estimate([...this.rows]);
    return true;
  }

  // The result

  roots() { return this.selection.folders(); }
  skips() { return this.selection.skips(); }
  /// Something would change (Save is off until it does).
  changesSomething() {
    return this.roots().map(key).sort().join("\n") !== this.initial.folders.join("\n")
      || this.skips().map(key).sort().join("\n") !== this.initial.skips.join("\n");
  }

  /// What a row adds as checked now: all of it but its unchecked subfolders, or just its checked ones.
  searchedPart(row) {
    const answer = this.estimates.get(key(row));
    if (!answer) return null;
    const part = emptyPart();
    const subfolders = answer.subfolders || [];
    if (!this.selection.isSearched(row)) {
      for (const subfolder of subfolders) if (this.selection.isSearched(subfolder.folder)) addPart(part, subfolder, 1);
      return part;
    }
    // Inside another listed folder that searches it: counted there.
    if (this.rows.some((other) => !same(other, row) && inside(row, other) && this.selection.isSearched(other))) return part;
    addPart(part, answer, 1);
    for (const subfolder of subfolders) if (!this.selection.isSearched(subfolder.folder)) addPart(part, subfolder, -1);
    for (const name of ["seconds", "later", "bytes"]) part[name] = Math.max(0, part[name]);
    for (const kind of Object.keys(part.files)) if (part.files[kind] <= 0) delete part.files[kind];
    return part;
  }

  /// The whole selection: files and seconds by kind, and the first pass and the rest of long files.
  total() {
    const total = emptyPart();
    for (const row of this.rows) {
      const part = this.searchedPart(row);
      if (!part) continue;
      total.seconds += part.seconds;
      total.bytes += part.bytes;
      total.later += part.later;
      for (const [kind, count] of Object.entries(part.files)) total.files[kind] = (total.files[kind] || 0) + Math.max(0, count);
      for (const [kind, seconds] of Object.entries(part.kinds)) total.kinds[kind] = (total.kinds[kind] || 0) + Math.max(0, seconds);
    }
    return total;
  }

  // Drawing it

  render() {
    if (!this.list) return;
    const scroller = this.list.closest(".scroll") || this.list.closest("main");
    const scroll = scroller.scrollTop;
    const focused = document.activeElement?.dataset?.focus;
    const items = this.rows.map((row) => this.folderBox(row));
    const add = element("button", "add-folder");
    add.innerHTML = PLUS;
    add.append(this.addTitle);
    add.dataset.focus = "add";
    add.onclick = () => this.pick();
    items.push(add);
    if (this.code && !this.rows.length) {
      items.unshift(element("p", "list-note", "No folders with code turned up in your home folder. Add the ones that "
                                              + "hold your repositories."));
    }
    if (this.note) {
      const note = element("p", "list-note");
      note.innerHTML = INFO;
      note.append(this.note);
      items.push(note);
    }
    this.list.replaceChildren(...items);
    scroller.scrollTop = scroll;
    // The keyboard stays where it was (a list drawn again would lose it).
    if (focused) this.list.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus();
    this.onChange();
  }

  async pick() {
    const picked = await invoke("pick_folders", { title: "Add Folders" }) || [];
    if (picked.length) this.add(picked);
  }

  folderBox(row) {
    const answer = this.estimates.get(key(row));
    const mark = this.selection.mark(row);
    const subfolders = answer?.subfolders || [];
    const isOpen = this.open.has(key(row)) && subfolders.length > 0;
    const box = element("div", "folder-box" + (mark === "off" ? " off" : ""));
    const header = element("div", "folder");
    const name = nameOf(row);
    const disclosure = element("button", "disclosure" + (isOpen ? " open" : ""));
    disclosure.innerHTML = CHEVRON;
    disclosure.disabled = !subfolders.length;
    disclosure.title = isOpen ? "Hide its subfolders" : "Choose among its subfolders";
    disclosure.setAttribute("aria-label", (isOpen ? "Hide the subfolders of " : "Show the subfolders of ") + name);
    disclosure.setAttribute("aria-expanded", String(isOpen));
    disclosure.dataset.focus = "open:" + key(row);
    disclosure.onclick = (event) => {
      event.stopPropagation();
      this.setOpen(row, !this.open.has(key(row)));
    };
    const check = checkbox(mark, name, () => this.toggle(row));
    check.dataset.focus = "check:" + key(row);
    // A tree's keys on a folder's checkbox: → opens it, ← closes it.
    check.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" && subfolders.length && !isOpen) this.setOpen(row, true);
      else if (event.key === "ArrowLeft" && isOpen) this.setOpen(row, false);
      else return;
      event.preventDefault();
    });
    const text = element("div", "text");
    text.append(element("div", "name", name));
    // Off, a folder shows all it holds (what checking it would take); else what's searched of it.
    const part = mark === "off" ? wholePart(answer) : this.searchedPart(row);
    if (answer?.failed) text.append(element("div", "counts", "Couldn't look inside it; it can still be searched."));
    else if (answer?.readable === false) text.append(element("div", "counts problem", "DigUp can't read it."));
    else if (part && Object.values(part.files).some((count) => count > 0)) text.append(kindCounts(part.files));
    else {
      const empty = !answer ? native(row) : !Object.keys(answer.files || {}).length
        ? (this.code ? "No code here" : "Nothing to search here yet") : "Nothing to search in the subfolders checked";
      text.append(element("div", "path", empty));
    }
    header.append(disclosure, check, folderIcon(row, 32), text);
    if (!answer) header.append(spinner());
    else if (!answer.failed && answer.readable !== false && this.calibrated) {
      header.append(this.timeOf(part, mark === "off", !Object.keys(answer.files || {}).length));
    }
    header.onclick = (event) => {
      if (event.target.closest("button, input")) return;
      this.toggle(row);
    };
    box.append(header);
    if (isOpen) {
      const list = element("div", "subfolders");
      const all = this.showAll.has(key(row));
      for (const subfolder of all ? subfolders : subfolders.slice(0, SHORT_LIST)) list.append(this.subfolderRow(subfolder));
      if (!all && subfolders.length > SHORT_LIST) {
        const more = element("button", "more", `Show ${subfolders.length - SHORT_LIST} more`);
        more.dataset.focus = "more:" + key(row);
        more.onclick = () => {
          this.showAll.add(key(row));
          this.render();
        };
        list.append(more);
      }
      box.append(list);
    }
    return box;
  }

  subfolderRow(subfolder) {
    const on = this.selection.isSearched(subfolder.folder);
    const name = nameOf(subfolder.folder);
    const item = element("div", "subfolder" + (on ? "" : " off"));
    const check = checkbox(on ? "on" : "off", name, () => this.toggleSubfolder(subfolder.folder));
    check.dataset.focus = "sub:" + key(subfolder.folder);
    item.append(check, folderIcon(subfolder.folder, 16), element("span", "name", name), kindCounts(subfolder.files || {}));
    if (this.calibrated) {
      const seconds = subfolder.seconds || 0, later = subfolder.later_seconds || 0;
      const time = element("span", "time", approximately(seconds)
        + (this.code ? ` · ${roughBytes(subfolder.bytes || 0)}` : later >= 30 ? ` + ${roughDuration(later)} later` : ""));
      time.title = this.code ? CODE_HELP : LATER_HELP;
      item.append(time);
    }
    item.onclick = (event) => { if (!event.target.closest("input")) this.toggleSubfolder(subfolder.folder); };
    return item;
  }

  /// "≈ 4 min", with "+ 2 min later" for the rest of long files, or the code index's size.
  timeOf(part, quiet, empty) {
    const time = element("div", "time" + (quiet ? " quiet" : ""), empty ? "—" : approximately(part?.seconds || 0));
    if (this.code) {
      if ((part?.bytes || 0) > 0) time.append(element("small", "", roughBytes(part.bytes)));
    } else if ((part?.later || 0) >= 30) {
      time.append(element("small", "", `+ ${roughDuration(part.later)} later`));
    }
    time.title = this.code ? CODE_HELP : LATER_HELP;
    return time;
  }
}

const LATER_HELP = "The first pass takes this long. Long PDFs and documents get their first pages in it, and the rest "
  + "afterwards, once everything else is in.";
const CODE_HELP = "How long reading this code takes, once, and about how much room its index needs. After that, only "
  + "what changes is read again.";

function emptyPart() { return { seconds: 0, later: 0, bytes: 0, files: {}, kinds: {} }; }

function addPart(part, estimate, sign) {
  part.seconds += sign * (estimate.seconds || 0);
  part.bytes += sign * (estimate.bytes || 0);
  part.later += sign * (estimate.later_seconds || 0);
  for (const [kind, count] of Object.entries(estimate.files || {})) part.files[kind] = (part.files[kind] || 0) + sign * count;
  for (const [kind, seconds] of Object.entries(estimate.kind_seconds || {})) part.kinds[kind] = (part.kinds[kind] || 0) + sign * seconds;
}

function wholePart(answer) {
  if (!answer) return null;
  const part = emptyPart();
  addPart(part, answer, 1);
  return part;
}

/// A checkbox that can also show "some of it". A click asks for the change; what it shows comes from the selection.
function checkbox(mark, label, action) {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "f-check";
  box.checked = mark === "on";
  box.indeterminate = mark === "mixed";
  box.setAttribute("aria-label", label);
  box.onclick = (event) => {
    event.preventDefault();   // the selection decides what it shows
    event.stopPropagation();
    action();
  };
  return box;
}

/// The shell's icon for a folder (Windows' own, Desktop's and Documents' included), the folder glyph until it comes.
function folderIcon(path, size) {
  const image = document.createElement("img");
  image.className = "folder-icon";
  image.alt = "";
  image.draggable = false;
  const id = `${key(path)}@${size}`;
  image.src = icons.get(id) || FOLDER;
  if (!icons.has(id)) {
    icons.set(id, null);
    invoke("file_icon", { path: native(path), size: Math.round(size * (window.devicePixelRatio || 1)) })
      .then((url) => {
        if (typeof url !== "string" || !url.startsWith("data:")) return;
        icons.set(id, url);
        for (const other of document.querySelectorAll("img.folder-icon")) if (other.dataset.icon === id) other.src = url;
      })
      .catch(() => {});
  }
  image.dataset.icon = id;
  return image;
}

/// What a folder holds, compactly: an icon and a number a kind, the full wording in the tooltip (KindCounts).
function kindCounts(files) {
  const counts = element("div", "counts kinds");
  const described = [];
  for (const kind of Object.keys(KINDS)) {
    const count = files[kind] || 0;
    if (count <= 0) continue;
    const item = element("span", "kind");
    item.innerHTML = `<svg viewBox="0 0 24 24">${KINDS[kind]}</svg>`;
    item.append(count.toLocaleString());
    counts.append(item);
    described.push(`${count.toLocaleString()} ${NOUNS[kind][count === 1 ? 0 : 1]}`);
  }
  counts.title = described.join(", ");
  counts.setAttribute("aria-label", counts.title);
  return counts;
}

function spinner() {
  const ring = element("div", "f-ring");
  ring.setAttribute("aria-label", "Looking inside it");
  return ring;
}

/// "≈ 8 s", "≈ 2 min", or "< 1 s" for a few short files.
function approximately(seconds) { return seconds < 0.5 ? "< 1 s" : `≈ ${roughDuration(seconds)}`; }

/// "45 s", "4 min", "1.5 h": the precision an estimate deserves (the Mac app's roughDuration).
function roughDuration(seconds) {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

/// "360 KB", "12 MB", "1.2 GB": an index's size, roughly.
function roughBytes(count) {
  if (count < 1e6) return `${Math.max(1, Math.round(count / 1e3))} KB`;
  if (count < 1e9) return `${Math.round(count / 1e6)} MB`;
  return `${(count / 1e9).toFixed(1)} GB`;
}

// MARK: Skip some folders or file types (the first launch's folders step)

let folders = null;       // the folders step's list
let codeFolders = null;   // the code step's
let searchCode = false;

function renderSkips() {
  if (codeMode || !firstTime) return;
  const list = $("skipped-list");
  list.replaceChildren(...folders.skips().map((path) => {
    const item = element("li");
    const remove = element("button", "unskip");
    remove.innerHTML = MINUS;
    remove.title = "Search this folder again";
    remove.setAttribute("aria-label", `Search ${nameOf(path)} again`);
    remove.dataset.focus = "unskip:" + key(path);
    remove.onclick = () => folders.unskip(path);
    const where = element("span", "path", native(path));
    where.title = native(path);
    item.append(folderIcon(path, 16), where, remove);
    return item;
  }));
}

function setSkipsOpen(on) {
  $("skips-toggle").setAttribute("aria-expanded", String(on));
  $("skips-body").hidden = !on;
}

$("skips-toggle").addEventListener("click", () => setSkipsOpen($("skips-body").hidden));

$("skip-folder").addEventListener("click", async () => {
  const picked = await invoke("pick_folders", { title: "Skip Folders" }) || [];
  if (picked.length) folders.skip(picked);
});

$("skip-types").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.stopPropagation();   // Return applies the types; it doesn't continue
  folders.setTypes(event.target.value);
});
$("skip-types").addEventListener("change", (event) => folders.setTypes(event.target.value));

// MARK: The code step (a first launch that finds folders with code): off until turned on

$("search-code").addEventListener("change", (event) => {
  searchCode = event.target.checked;
  if (searchCode) codeFolders.startEstimates();
  renderCode();
});

function renderCode() {
  $("search-code").checked = searchCode;
  $("search-code-state").textContent = searchCode ? "On" : "Off";
  $("code-scroll").hidden = !searchCode;
  $("editor-row").hidden = !searchCode;
  renderFooter();
}

/// "Open code in": the editors installed, then the file's default app (Settings → Code's list).
function showEditors() {
  const code = settings.code || {};
  const editors = [...(code.editors || []), { id: "default", name: "The file's default app" }];
  $("editor").replaceChildren(...editors.map((editor) => {
    const option = element("option", "", editor.name);
    option.value = editor.id;
    return option;
  }));
  $("editor").value = editors.some((editor) => editor.id === code.editor) ? code.editor : editors[0].id;
}

$("editor").addEventListener("change", (event) => {
  invoke("set_code_editor", { editor: event.target.value }).catch(() => {});
});

// MARK: Steps

function render() {
  PAGES.forEach((name, index) => { $(name).hidden = index !== page; });
  const name = PAGES[page];
  $("back").hidden = firstTime && (page === 0 || page === PAGES.length - 1);
  $("back").textContent = firstTime ? "Back" : "Cancel";
  $("next").textContent = !firstTime ? "Save" : name === "welcome" ? "Get Started" : name === "ready" ? "Done" : "Continue";
  // The step pips (StepDots): the first launch's steps only.
  $("pips").hidden = !firstTime;
  $("pips").setAttribute("aria-label", `Step ${page + 1} of ${PAGES.length}`);
  $("pips").replaceChildren(...PAGES.map((_, index) => element("span", index === page ? "current" : "")));
  if (name === "code") renderCode();
  if (name === "shortcut") renderTry();
  if (name === "ready") renderProgress();
  renderDownload();
  renderFooter();
}

function renderFooter() {
  const name = PAGES[page];
  let summary = "";
  if (name === "folders") {
    const roots = folders.roots();
    const waiting = !folders.estimatesDone();
    if (codeMode) {
      // The Code Folders window: what reading the code checked takes, and its index (Onboarding.swift's codeSummary).
      summary = !roots.length ? (folders.changesSomething() ? "Code search turns off" : "Check the folders with your code")
        : waiting ? "Looking at your code…" : folders.calibrated ? codeSummary(folders) : "";
    } else if (!roots.length) summary = "Choose at least one folder";
    else if (waiting) summary = "Looking at your folders…";
    // Later (Choose Folders…) the folders searched already aren't read again: no first pass to tell.
    else if (!firstTime) summary = "";
    else if (folders.calibrated) summary = `First pass: about ${roughDuration(folders.total().seconds)}`;
    else summary = "Times show once DigUp has timed this computer";
  }
  if (name === "code" && searchCode) {
    summary = !codeFolders.roots().length ? "Check the folders with your code"
      : !codeFolders.estimatesDone() ? "Looking at your code…" : codeSummary(codeFolders);
  }
  $("summary").textContent = summary;
  $("summary").title = summary;
  $("next").disabled = name === "folders" && (codeMode || !firstTime ? !folders.changesSomething()
                                                                      || (!codeMode && !folders.roots().length)
                                                                    : !folders.roots().length);
  if (name === "folders" && firstTime && !codeMode) renderSkips();
}

/// "About 4 min, 12 MB", "Under a second, 360 KB".
function codeSummary(choices) {
  const total = choices.total();
  return (total.seconds < 1 ? "Under a second" : `About ${roughDuration(total.seconds)}`) + `, ${roughBytes(total.bytes)}`;
}

async function next() {
  const name = PAGES[page];
  if ($("next").disabled) return;
  if (name === "folders") {
    $("next").disabled = true;
    try {
      if (codeMode) {
        await invoke("set_code_folders", { folders: folders.roots().map(native), skipped: folders.skips().map(native) });
      } else {
        // The file types typed and not yet applied (a click on Continue doesn't end the field's editing).
        if (firstTime) {
          folders.setTypes($("skip-types").value);
          if (folders.types.join() !== (settings.skipTypes || []).join()) {
            settings.skipTypes = await invoke("set_skip_types", { types: folders.types.join(", ") }) || folders.types;
          }
        }
        // Indexing starts now (once the model is in), while the rest of setup goes on.
        await invoke("apply_setup_folders", { folders: folders.roots().map(native), skipped: folders.skips().map(native) });
      }
    } catch (error) {
      $("summary").textContent = String(error);
      $("next").disabled = false;
      return;
    }
    if (!firstTime) {
      invoke("close_window").catch(() => {});
      return;
    }
  }
  if (name === "code" && searchCode && codeFolders.roots().length) {
    $("next").disabled = true;
    try {
      await invoke("set_code_folders", { folders: codeFolders.roots().map(native), skipped: codeFolders.skips().map(native) });
    } catch (error) {
      $("summary").textContent = String(error);
      $("next").disabled = false;
      return;
    }
  }
  if (name === "ready") {
    $("next").disabled = true;
    const choices = { indexOnBattery: $("battery").checked };
    if (!$("login-row").hidden) choices.openAtLogin = $("login").checked;
    try {
      await invoke("finish_setup", choices);
    } catch (error) {
      $("progress-note").textContent = String(error);
      $("next").disabled = false;
    }
    return;
  }
  go(page + 1);
}

function back() {
  if (!firstTime) {
    invoke("close_window").catch(() => {});
    return;
  }
  if (page > 0 && page < PAGES.length - 1) go(page - 1);
}

function go(index) {
  page = Math.max(0, Math.min(PAGES.length - 1, index));
  if (PAGES[page] === "folders") folders.startEstimates();
  if (PAGES[page] === "code" && searchCode) codeFolders.startEstimates();
  // A new step starts with nothing focused: Enter is Continue, Tab goes to its first control.
  document.activeElement?.blur?.();
  render();
}

$("next").addEventListener("click", next);
$("back").addEventListener("click", back);

// The keys: Enter is the default button (Continue, Get Started, Done, Save) wherever the focus isn't on a control that
// takes it; Esc is Cancel in Choose Folders… and Code Folders (the Mac's default and cancel actions).
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (event.key === "Enter") {
    if (target.closest?.("button, select, textarea, a, input[type=text], input:not([type])")) return;
    event.preventDefault();
    next();
  } else if (event.key === "Escape" && !firstTime) {
    event.preventDefault();
    back();
  }
});

/// Debug runs (--debug-setup): every offered folder, every page, then Done.
async function clickThrough() {
  while (page < PAGES.length - 1) {
    await next();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await next();
}

// MARK: The model's download (DownloadStatus, and ModelDownload.swift's recovery: Try Again, Use Files…, Copy Links)

const progress = {
  state: {},                 // the shell's snapshot (status.rs)
  model: { state: "checking" },
  samples: [],               // the download: [time, bytes], the last few seconds of them
  pass: null,                // this indexing pass: {start, done: {kind: n}, total, doneFiles}
  rest: null,                // the rest of long files: {done, total, files}
};

/// "42% · about 1 min left", "Checking the download…", "Waiting for the network…" (ModelDownload.progressText).
function downloadText(model) {
  if (model.state === "waiting" || model.problem) return "Waiting for the network…";
  if (model.state === "checking") return "Checking the download…";
  if (!model.total) return "Starting…";
  const percent = `${Math.floor((100 * model.bytes) / model.total)}%`;
  const left = model.secondsLeft ?? (downloadRate() > 0 ? (model.total - model.bytes) / downloadRate() : null);
  if (left == null) return percent;
  return percent + " · " + (left < 50 ? "less than a minute left" : `about ${roughDuration(left)} left`);
}

function renderDownload() {
  const model = progress.model, box = $("download");
  // On the welcome step and in the later windows there's none; the last step shows it big.
  box.hidden = !firstTime || codeMode || page === 0 || PAGES[page] === "ready";
  if (box.hidden) return;
  const parts = [];
  const text = (words, className = "") => {
    const span = element("span", "text " + className, words);
    span.title = words;
    return span;
  };
  if (model.state === "ready") {
    const icon = element("span", "ok");
    icon.innerHTML = CHECK;
    parts.push(icon.firstChild, text("Model ready"));
    parts[0].classList.add("ok");
  } else if (model.state === "failed") {
    const icon = element("span");
    icon.innerHTML = WARNING;
    icon.firstChild.classList.add("warn");
    parts.push(icon.firstChild, text(model.message || "The model couldn't download"),
               modelButton("retry", "Try Again"), modelButton("files", "Use Files…"));
  } else if (model.state === "needed") {
    const icon = element("span");
    icon.innerHTML = DOWN;
    parts.push(icon.firstChild, text("Model not downloaded"), modelButton("retry", "Download"));
  } else {
    const fraction = model.state === "downloading" && model.total ? model.bytes / model.total : null;
    parts.push(fraction == null ? element("div", "f-ring") : ring(fraction), text(`Downloading the model · ${downloadText(model)}`));
    if (model.problem) parts[1].title = model.problem;
  }
  const focused = document.activeElement?.dataset?.model;
  box.replaceChildren(...parts);
  if (focused && box.contains(document.activeElement) === false) box.querySelector(`[data-model="${focused}"]`)?.focus();
}

/// A determinate ProgressRing.
function ring(fraction) {
  const length = 2 * Math.PI * 6.5;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ring");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("role", "progressbar");
  svg.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
  svg.innerHTML = `<circle class="track" cx="8" cy="8" r="6.5"/><circle class="value" cx="8" cy="8" r="6.5" `
    + `stroke-dasharray="${length}" stroke-dashoffset="${length * (1 - Math.max(0, Math.min(1, fraction)))}"/>`;
  return svg;
}

function modelButton(action, title) {
  const button = element("button", "f-button small", title);
  button.dataset.model = action;
  if (action === "files") button.title = "Downloaded the model's two files somewhere else? Choose them here.";
  return button;
}

// The recovery buttons, wherever they are (the footer, the last step's info bar).
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-model]");
  if (!button) return;
  const action = button.dataset.model;
  if (action === "retry") {
    progress.model = { state: "checking" };
    showModel(progress.model);
    invoke("retry_download", {}).catch((error) => showModel({ state: "failed", message: String(error) }));
  } else if (action === "files") {
    try {
      const answer = await invoke("use_model_files", {});
      if (answer && !answer.ok && answer.message) showModel({ ...progress.model, state: "failed", message: answer.message });
    } catch (error) {
      showModel({ state: "failed", message: String(error) });
    }
  } else if (action === "links") {
    try {
      const links = await invoke("model_links", {}) || [];
      await invoke("copy_text", { text: links.join("\n") });
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = "Copy Links"; }, 1500);
    } catch {
      // Nothing to copy.
    }
  }
});

// The model for the footer and the last step, and the download's pace.
function showModel(model) {
  progress.model = model || { state: "checking" };
  if (progress.model.state === "downloading" && progress.model.bytes != null) {
    progress.samples.push([Date.now(), progress.model.bytes]);
    while (progress.samples.length > 2 && Date.now() - progress.samples[0][0] > 8000) progress.samples.shift();
  }
  renderDownload();
  if (PAGES[page] === "ready") renderProgress();
}

/// The download's bytes a second over the last few seconds.
function downloadRate() {
  const samples = progress.samples;
  if (samples.length < 2) return 0;
  const [firstTime, firstBytes] = samples[0], [lastTime, lastBytes] = samples[samples.length - 1];
  return lastTime > firstTime ? (lastBytes - firstBytes) / ((lastTime - firstTime) / 1000) : 0;
}

// MARK: The last step: the download, then indexing, as it goes

function renderProgress() {
  const { state, model } = progress;
  let fraction = null, busy = false, done = false, label = "", time = "", note = "";
  if (model.state === "downloading") {
    label = "Downloading the model";
    fraction = model.total ? model.bytes / model.total : 0;
    time = model.total ? downloadText(model) : "";
    note = "865 MB, once. DigUp starts reading your folders when it's in; until then, search finds files by name.";
    if (model.problem) note = `${model.problem}; trying again.`;
  } else if (model.state === "waiting") {
    label = "Waiting for the network to download the model";
    busy = true;
  } else if (model.state === "failed") {
    label = "The model couldn't download";
    note = "Until it's in, search finds files by name.";
  } else if (model.state === "checking") {
    label = "Checking the model";
    busy = true;
  } else if (state.measuring) {
    label = "Checking this computer's speed";
    busy = true;
    note = "DigUp times its model on this computer once, to tell how long indexing takes here.";
  } else if (state.activity === "indexing" && state.indexing) {
    const { done: count, total } = state.indexing;
    label = "Reading your files";
    fraction = total ? count / total : 0;
    const seconds = timeLeft();
    time = `${count.toLocaleString()} of ${total.toLocaleString()}` + (seconds != null ? ` · ${leftText(seconds)}` : "");
    note = "You can search right away: results fill in as DigUp reads your files, newest first.";
  } else if (state.activity === "finishing" && progress.rest) {
    const { done: count, total, files } = progress.rest;
    label = `Reading the rest of ${files.toLocaleString()} long ${files === 1 ? "file" : "files"}`;
    fraction = total ? count / total : 0;
    const later = folders.total().later, pace = progress.pace || 1;
    time = `${Math.floor(fraction * 100)}%` + (later > 0 ? ` · ${leftText(later * (1 - fraction) * pace)}` : "");
    note = "Everything is searchable; long PDFs and documents are being read past their first pages.";
  } else if (state.activity === "idle" || (state.activity === "starting" && state.searchable > 0 && !state.pending)) {
    label = state.searchable ? `${state.searchable.toLocaleString()} ${state.searchable === 1 ? "file" : "files"} indexed` : "Up to date";
    done = true;
    note = "Search from the window, or press the shortcut in any app.";
  } else if (state.activity === "failed") {
    label = state.line || "Indexing stopped";
  } else {
    label = "Looking at your folders";
    busy = true;
  }
  $("progress-what").textContent = label;
  $("progress-left").textContent = time;
  $("bar").className = "f-progress" + (busy ? " indeterminate" : "") + (done ? " done" : "");
  $("bar-fill").style.width = busy || done ? "" : `${Math.round(100 * Math.max(0, Math.min(1, fraction ?? 0)))}%`;
  $("progress-note").textContent = note;
  // A download that needs the person: why, and what can be done.
  const failed = model.state === "failed";
  $("progress").hidden = failed;
  $("model-problem").hidden = !failed;
  $("model-problem-text").textContent = failed && model.message ? `(${model.message}).` : "";
}

/// Seconds left in this pass: what's still to come of each kind, at its estimated cost, at the pace this computer
/// has kept so far (the estimate's times are this computer's once it's timed; the pace corrects the rest).
function timeLeft() {
  const pass = progress.pass, state = progress.state;
  if (!pass || !state.indexing) return null;
  const part = folders.total();
  let remaining = 0, doneWork = 0, remainingFiles = 0;
  for (const [kind, files] of Object.entries(part.files)) {
    const perFile = files > 0 ? (part.kinds[kind] || 0) / files : 0;
    const done = pass.done[kind] || 0;
    remaining += Math.max(0, files - done) * perFile;
    remainingFiles += Math.max(0, files - done);
    doneWork += Math.min(done, files) * perFile;
  }
  // The pass's own count of what's left (some files aren't read: too small, or skipped) scales what's still to come.
  const left = Math.max(0, state.indexing.total - state.indexing.done);
  if (remainingFiles > 0) remaining *= left / remainingFiles;
  const elapsed = (Date.now() - pass.start) / 1000;
  const sure = doneWork >= 3 || elapsed >= 15;
  if (sure && doneWork > 0) progress.pace = Math.max(0.05, Math.min(500, elapsed / doneWork));
  if (!sure && !folders.calibrated) return null;
  return remaining * (sure ? progress.pace : 1);
}

function leftText(seconds) {
  return seconds < 60 ? "less than a minute left" : `about ${roughDuration(seconds)} left`;
}

tauri.event.listen("state", ({ payload }) => {
  progress.state = payload || {};
  if (PAGES[page] === "ready") renderProgress();
});

tauri.event.listen("helper", ({ payload }) => {
  const { from, event } = payload || {};
  if (from !== "index" || !event || event.code) return;
  if (event.event === "sync" && event.new > 0) {
    progress.pass = { start: Date.now(), done: {}, doneFiles: 0 };
  } else if (event.event === "file") {
    // A pass starts over when its count does (the backfill after new files, a later sync).
    if (!progress.pass || event.done < progress.pass.doneFiles) progress.pass = { start: Date.now(), done: {}, doneFiles: 0 };
    progress.pass.done[event.kind] = (progress.pass.done[event.kind] || 0) + 1;
    progress.pass.doneFiles = event.done;
  } else if (event.event === "rest") {
    progress.rest = { done: event.done, total: event.total, files: event.files };
  }
});

// This computer was timed: the folders' times are its own now.
tauri.event.listen("speed", () => {
  for (const choices of [folders, codeFolders]) if (choices?.rows.length) choices.estimate([...choices.rows]);
});

// MARK: The ready step's switches

for (const [box, label] of [["login", "login-state"], ["battery", "battery-state"]]) {
  $(box).addEventListener("change", () => { $(label).textContent = $(box).checked ? "On" : "Off"; });
}

function showSwitches() {
  // Opening at login: on unless the person turned it off before (or this run can't, a dev run's).
  const canLogin = info.canOpenAtLogin ?? settings.canOpenAtLogin ?? true;
  $("login-row").hidden = !canLogin;
  $("login").checked = firstTime ? true : !!(info.openAtLogin ?? settings.openAtLogin);
  $("battery").checked = info.indexOnBattery ?? settings.indexOnBattery ?? true;
  for (const [box, label] of [["login", "login-state"], ["battery", "battery-state"]]) {
    $(label).textContent = $(box).checked ? "On" : "Off";
  }
}

// MARK: The shortcut: the recorder (Hotkey.swift's ShortcutRecorder), and trying it

let hotkeyWorked = false;
let recording = null;   // stops the recording under way (shortcut.js)

function keycaps(caps, big) {
  const keys = element("span", "keys" + (big ? " big" : ""));
  keys.append(...caps.filter(Boolean).map((cap) => element("kbd", "key", cap)));
  keys.setAttribute("aria-label", caps.join(" "));
  return keys;
}

function capsOf(hotkey) {
  return isMac ? [...hotkey.replace(/[^⌃⌥⇧⌘]/g, "")].concat(hotkey.replace(/[⌃⌥⇧⌘]/g, "")) : (hotkey || "").split("+");
}

function showKeys(hotkey) {
  info.hotkey = hotkey;
  $("keys").replaceWith(Object.assign(keycaps(capsOf(hotkey), true), { id: "keys" }));
  renderTry();
}

/// "Try it now: press Ctrl+Alt+Space.", and once it's pressed (the shell says, `shortcut-pressed`): "That's it."
function renderTry() {
  const line = $("try");
  line.className = "try" + (hotkeyWorked ? " worked" : "");
  if (hotkeyWorked) {
    line.innerHTML = CHECK;
    line.append("That's it. It works from any app.");
  } else {
    line.textContent = info.hotkey && info.shortcut?.method !== "by_hand" ? `Try it now: press ${info.hotkey}.` : "";
  }
}

tauri.event.listen("shortcut-pressed", () => {
  if (PAGES[page] !== "shortcut" || hotkeyWorked) return;
  hotkeyWorked = true;
  renderTry();
});

/// The search panel's keys (ShortcutStep's KeyTips), as this system names them.
function showTips() {
  const command = isMac ? "⌘" : "Ctrl";
  const tips = [
    [[isMac ? "↩" : "Enter"], "Open the file"],
    [[command, isMac ? "↩" : "Enter"], isMac ? "Show it in Finder" : isWindows ? "Show it in File Explorer" : "Show it in its folder"],
    [["Space"], isMac ? "Quick Look, after arrowing to a result" : "Preview it, after arrowing to a result"],
    [[command, "C"], "Copy the file, to paste anywhere"],
    [[isMac ? "esc" : "Esc"], "Close"],
  ];
  $("tips").replaceChildren(...tips.flatMap(([caps, text]) => {
    const term = element("dt");
    term.append(...keycaps(caps).childNodes);
    return [term, element("dd", "", text)];
  }));
}

/// Where the shortcut lives on a desktop that keeps it itself (GNOME, KDE), or the command to give it (other Wayland
/// desktops). Where DigUp grabs it itself (Windows, X11), the recorder changes it.
function showShortcut(shortcut) {
  const notes = {
    gnome: "DigUp adds it to GNOME's keyboard shortcuts. To change it later: Settings → Keyboard → View and Customize " +
      "Shortcuts → Custom Shortcuts.",
    kde: "DigUp adds it to KDE's shortcuts. To change it later: System Settings → Shortcuts → DigUp.",
    by_hand: "This desktop doesn't let apps set their own shortcuts. To open the panel with one, add a shortcut in " +
      "its keyboard settings that runs:",
  };
  const note = notes[shortcut?.method];
  $("shortcut-note").hidden = !note;
  $("shortcut-note").textContent = note || "";
  $("shortcut-command").hidden = shortcut?.method !== "by_hand";
  $("shortcut-command").textContent = shortcut?.command || "";
  const grab = shortcut?.method === "grab";
  $("recorder").disabled = !grab;
  $("recorder").setAttribute("aria-label", grab ? `Shortcut ${info.hotkey}, click to change` : `Shortcut ${info.hotkey}`);
  caption(grab ? "Click to change" : "");
}

function caption(text, problem) {
  $("recorder-caption").textContent = text;
  $("recorder-caption").classList.toggle("problem", !!problem);
}

$("recorder").addEventListener("click", () => {
  if (recording) {
    recording();
    return;
  }
  const button = $("recorder");
  button.classList.add("recording");
  button.replaceChildren(element("span", "", "Press the new shortcut…"));
  button.setAttribute("aria-label", "Recording a new shortcut");
  caption("Esc cancels");
  recording = recordShortcut((text) => {
    caption(/Add Ctrl/.test(text) ? text : "Esc cancels", /Add Ctrl/.test(text));
  }, (shown, problem) => {
    recording = null;
    button.classList.remove("recording");
    button.replaceChildren(Object.assign(keycaps(capsOf(shown || info.hotkey), true), { id: "keys" }));
    if (shown) showKeys(shown);
    button.setAttribute("aria-label", `Shortcut ${info.hotkey}, click to change`);
    caption(problem || "Click to change", !!problem);
  });
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// MARK: Starting

/// The usual folders in the Mac's order (Desktop, Documents, Downloads, Pictures, Movies, Music); others after.
function macOrder(paths) {
  const order = ["desktop", "documents", "downloads", "pictures", "videos", "movies", "music"];
  const rank = (path) => {
    const index = order.indexOf(nameOf(path).toLowerCase());
    return index < 0 ? order.length : index;
  };
  return paths.map((path, index) => [path, index]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([path]) => path);
}

async function start() {
  const [answer, more] = await Promise.all([
    invoke(codeMode ? "code_setup_info" : "setup_info"),
    invoke("settings_info").catch(() => null),
  ]);
  info = { ...info, ...(answer || {}) };
  settings = more || {};
  firstTime = !info.setUp;
  document.body.classList.toggle("first", firstTime && !codeMode);
  const offered = codeMode ? info.offered || [] : macOrder(info.offered || []);
  const chosen = info.chosen || [];
  // A chosen subfolder of a folder listed shows in that folder's list, not as a folder of its own.
  const rows = [...offered, ...chosen.filter((path) => !offered.some((row) => same(row, path) || same(row, parentOf(path))))];
  if (codeMode) {
    document.title = "Code Folders";
    $("folders-title").textContent = "Search your code";
    $("folders-subtitle").textContent = "Pick the folders that hold your projects; open one to pick among its repos. "
      + "DigUp reads each once, then what changes. Code is searched on its own: type code: in the search panel.";
    $("folders-note").hidden = true;
    $("code-folder-note").hidden = false;
  } else if (!firstTime) {
    document.title = "Choose Folders";
    $("folders-subtitle").textContent = "Pick folders, or open one to pick some of its subfolders. DigUp reads a new "
      + "folder once, then keeps up with what changes in it.";
  }
  // On a first launch every folder offered starts checked (the Mac's onboarding), unless some were chosen before.
  folders = new FolderChoices({
    list: $("folder-list"), rows, code: codeMode,
    chosen: firstTime && !codeMode && !chosen.length ? offered : chosen, skipped: info.skipped || [],
    types: codeMode ? [] : settings.skipTypes || [],
    addTitle: firstTime && !codeMode ? "Add Folder…" : "Choose Another Folder…",
  });
  folders.onChange = renderFooter;
  if (firstTime && !codeMode) {
    $("skips").hidden = false;
    $("skip-types").value = (settings.skipTypes || []).join(", ");
    setSkipsOpen(folders.skips().length > 0 || folders.types.length > 0);
  }
  if (firstTime && info.codeOffered?.length) {
    PAGES = ["welcome", "folders", "code", "shortcut", "ready"];
    codeFolders = new FolderChoices({ list: $("code-list"), rows: info.codeOffered, chosen: info.codeOffered,
                                      code: true, addTitle: "Add Folder…" });
    codeFolders.onChange = renderFooter;
    showEditors();
  }
  progress.state = info.state || {};
  if (!codeMode) {
    showModel(info.model);
    tauri.event.listen("model", ({ payload }) => showModel(payload));
    showKeys(info.hotkey || "");
    showShortcut(info.shortcut);
    showTips();
    showSwitches();
  }
  if (!firstTime) page = 1;   // Choose Folders… and Code Folders: the folders, with Save
  const asked = PAGES.indexOf(new URLSearchParams(location.search).get("page"));   // dev snapshots: ?page=folders
  if (asked >= 0) page = asked;
  // Windows asks nothing before DigUp reads a folder (macOS does: the Mac waits for the folders step), so the folders
  // are looked at from the start and their times are there when the step shows.
  folders.render();
  folders.startEstimates();
  codeFolders?.startEstimates();
  go(page);
  // The time left changes between events.
  setInterval(() => { if (PAGES[page] === "ready") renderProgress(); }, 1000);
  if (info.auto) setTimeout(clickThrough, 500);
}

start();
