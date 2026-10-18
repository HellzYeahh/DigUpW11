// The search panel of DigUp's Windows and Linux shell (tried out on the Mac first). Every keystroke shows keyword
// results at once (the last word as a prefix), and asks for the meaning results then too: they replace the keyword
// ones 120 ms after the keystroke, so the pause is the whole wait. Results far weaker than the best are folded under
// "N weaker matches". The helper (`digup search-service`) does the work; the Mac app's panel
// (Sources/DigUpApp/SearchPanel.swift, SearchPanelView.swift) is the reference for how it behaves. results.js has
// what a result says, previews.js what the preview draws (the window draws the same).
"use strict";

const TYPING_PAUSE = 120;          // ms after the keystroke until the meaning results show
const ROWS_PER_GROUP = 6;
const FIELD_HEIGHT = 56;
const PANEL_HEIGHT = 480;
const BIG_HEIGHT = 640;   // the panel at its tallest, for the big preview
const FADE_OUT = 120;     // ms, as the Mac's panel fades (in: 150)
const NOTE_TIME = 1600;   // ms "Copied …" stays in the footer
const PICTURE = { width: 410, height: 214 };   // the preview's picture box (the Mac's)
const WEAKER = "\u0000weaker";     // the selectable row that folds and unfolds the weaker matches
const CODE_EXAMPLES = ["code: retry a request with backoff", "code: where the settings are saved",
                       "code: parse the command line options"];
const SEARCH_ICON = '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6.5"/><path d="M15 15 L20.5 20.5"/></svg>';
// Wayland: the window fills the screen and this page places the panel (the shell's wayland.rs).
const fillsScreen = new URLSearchParams(location.search).has("fills");
// A group's name in the window's kind filters.
const FILTER_OF = { Screenshots: "screenshots", Images: "images", Documents: "documents", Video: "video",
                    Audio: "audio", Code: "code" };

const $ = (id) => document.getElementById(id);
const $panel = $("panel"), $query = $("query"), $body = $("body"), $list = $("list"), $preview = $("preview");
const $footer = $("footer"), $summary = $("summary"), $keys = $("keys"), $activity = $("activity");
const $glass = $("glass"), $spinner = $("spinner"), $message = $("message");

const state = {
  generation: 0,
  finalGeneration: -1,   // the generation whose meaning results are showing: late keyword results don't replace them
  phase: "empty",        // empty | words | meaning | wordsOnly | codeHint | codeOff
  hasCode: true,         // code search has folders (the state's hasCode)
  hasFolders: true,      // folders to search are chosen
  text: "",              // what was searched (without "code:")
  isCode: false,
  strong: [],
  weaker: [],
  groups: [],
  showWeaker: false,
  selection: null,       // a result's path, or WEAKER
  navigated: false,      // the arrow keys or a click moved the selection since the last edit
  encoder: "stopped",
  height: FIELD_HEIGHT,
  error: null,
  note: null,            // "Copied …", for a moment
  caveat: null,          // why results may be incomplete right now (the shell's status.rs)
  meaningUnavailable: null,   // why meaning search can't run yet: the model isn't in
  codeIndexing: null,    // {done, total} while code is being read
};
const meaning = meaningSearches(TYPING_PAUSE);
let noteTimer = null, hideTimer = null;
let debugPending = false;

// MARK: Searching

function queryChanged() {
  closeBig();
  const generation = ++state.generation;
  state.navigated = false;
  state.error = null;
  const typed = $query.value.trim();
  const code = /^code:/i.test(typed);
  const text = code ? typed.slice(5).trim() : typed;
  state.isCode = code;
  renderField();
  if (!typed) {
    meaning.cancel();
    show({ hits: [], strong: 0 }, text, "empty");
    return;
  }
  // "code:" alone, or without code folders: what to do instead of results.
  if (code && (!state.hasCode || !text)) {
    meaning.cancel();
    show({ hits: [], strong: 0 }, text, state.hasCode ? "codeHint" : "codeOff");
    return;
  }
  // Words now. The last word is probably half-typed, so it matches as a prefix.
  ask({ op: "search", q: text, code, meaning: false, prefix_last: true, limit: 40 })
    .then((reply) => {
      if (generation === state.generation && state.finalGeneration !== generation) show(reply, text, "words");
    })
    .catch(failed);
  // The meaning now too (its embedding, then its search), shown once the pause after this keystroke is over.
  meaning.run(() => ask({ op: "search", q: text, code, meaning: true, limit: 40 }), (reply) => {
    state.finalGeneration = generation;
    show(reply, text, reply.meaning ? "meaning" : "wordsOnly");
    if (debugPending) report();
  }, failed);
}

function show(reply, text, phase) {
  const hits = reply.hits || [];
  const strong = Math.min(reply.strong ?? hits.length, hits.length);
  state.text = text;
  state.phase = phase;
  state.strong = hits.slice(0, strong);
  state.weaker = hits.slice(strong);
  // Grouped by kind, the best hit's group first; code is one group with the room of all of them.
  const groups = new Map();
  for (const hit of state.strong) {
    const title = GROUP_OF[hit.kind] || "Files";
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(hit);
  }
  const perGroup = state.isCode ? ROWS_PER_GROUP * 3 : ROWS_PER_GROUP;
  state.groups = [...groups].map(([title, rows]) => ({ title, rows: rows.slice(0, perGroup), total: rows.length }));
  if (!state.navigated) state.showWeaker = false;
  // Whether recordings' apps take a moment ("Open at 0:06"), asked once per extension before anyone looks.
  for (const hit of hits) learnOpener(hit).then((changed) => { if (changed && state.phase !== "empty") renderFooter(); });
  // Follow the top hit until you pick something with the arrow keys.
  const ids = rowIDs();
  if (!state.navigated || !ids.includes(state.selection)) state.selection = ids[0] ?? null;
  render();
}

function failed(error) {
  state.error = String(error);
  renderFooter();
}

function rowIDs() {
  return [
    ...state.groups.flatMap((group) => group.rows.map((hit) => hit.path)),
    ...(state.weaker.length ? [WEAKER] : []),
    ...(state.showWeaker ? state.weaker.map((hit) => hit.path) : []),
  ];
}

function selectedHit() {
  return [...state.strong, ...state.weaker].find((hit) => hit.path === state.selection) ?? null;
}

function move(step) {
  const ids = rowIDs();
  if (!ids.length) return;
  const index = ids.indexOf(state.selection);
  state.navigated = true;
  select(ids[Math.max(0, Math.min(ids.length - 1, (index < 0 ? -1 : index) + step))]);
}

function toggleWeaker() {
  state.showWeaker = !state.showWeaker;
  state.selection = WEAKER;
  render();
}

// MARK: Actions

function openHit(hit) {
  if (hit) openResult(hit).catch(failed);
}

function revealHit(hit) {
  if (hit) invoke("reveal", { path: hit.path }).catch(failed);
}

/// Ctrl+C: the file, to paste in Explorer, a mail or a chat; "Copied …" says so.
function copied(hit) {
  flash(`Copied ${nameOf(hit.path)}`);
}

function flash(text) {
  state.note = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    state.note = null;
    renderFooter();
  }, NOTE_TIME);
  renderFooter();
}

/// The same search in the window, for a bigger look (only one kind, if given).
function openInWindow(kind) {
  invoke("open_window", { query: $query.value.trim(), kind: kind ?? null }).catch(failed);
}

/// Esc: closes the panel, fading as the Mac's does; the shell hides the window at the end of it.
function dismiss() {
  if (hideTimer) return;
  $panel.classList.add("hiding");
  hideTimer = setTimeout(() => {
    hideTimer = null;
    invoke("hide_panel").catch(() => {});
  }, FADE_OUT);
}

// MARK: Drawing

/// The panel's height: the window's, or in a window that fills the screen the panel's own, whose place the shell is
/// told so that only the panel takes the pointer.
function fit() {
  if (!fillsScreen) {
    invoke("panel_height", { height: state.height }).catch(() => {});
    return;
  }
  $panel.style.height = `${state.height}px`;
  const { left, top, width, height } = $panel.getBoundingClientRect();
  invoke("panel_area", { x: left, y: top, width, height }).catch(() => {});
}

if (fillsScreen) {
  document.documentElement.classList.add("fills-screen");
  window.addEventListener("resize", fit);
  fit();
}

/// The field: its icon becomes code's mark for a search of code, and with code search on one example is code's.
function renderField() {
  $glass.innerHTML = state.isCode ? ICONS.code : SEARCH_ICON;
  $glass.classList.toggle("code", state.isCode);
  $glass.title = state.isCode ? "Searching your code" : "";
  $query.placeholder = state.hasCode ? "Describe it: “zebra in a video”, “code: retry with backoff”…"
    : "Describe it: “payment error screenshot”, “zebra in a video”…";
  $spinner.hidden = !(state.phase === "words" && state.encoder === "starting");
}

/// New results or a new state: the list, the preview and the footer. Moving the selection redraws less (`select`).
function render() {
  const empty = state.phase === "empty";
  const height = empty ? FIELD_HEIGHT : $big.hidden ? PANEL_HEIGHT : BIG_HEIGHT;
  if (height !== state.height) {
    state.height = height;
    fit();
  }
  $body.hidden = empty;
  $footer.hidden = empty;
  renderField();
  if (empty) return;
  renderList();
  renderPreview();
  renderFooter();
}

/// The selection moved: only the rows' marks, the preview and the footer change (and the big preview follows).
function select(id) {
  state.selection = id;
  for (const node of $list.querySelectorAll("[data-id]")) {
    const selected = node.dataset.id === id;
    node.classList.toggle("selected", selected);
    node.setAttribute("aria-selected", String(selected));
  }
  $list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  renderPreview();
  renderFooter();
  if (!$big.hidden) {
    if (id === WEAKER) closeBig();
    else renderBig();
  }
}

function renderList() {
  const nothing = !state.strong.length && !state.weaker.length;
  $list.hidden = nothing;
  $list.replaceChildren();
  if (nothing) return;
  for (const group of state.groups) {
    $list.append(element("div", "group-title", group.title));
    for (const hit of group.rows) $list.append(row(hit));
    // More of this kind than the panel has room for: all of them in the window.
    if (group.total > group.rows.length && FILTER_OF[group.title]) {
      const more = element("button", "more", `Show all ${group.total} ${group.title.toLowerCase()}…`);
      more.title = `Open them in the DigUp window (${MOD}O shows everything)`;
      more.onmousedown = (event) => event.preventDefault();
      more.onclick = () => openInWindow(FILTER_OF[group.title]);
      $list.append(more);
    }
  }
  if (state.weaker.length) {
    const fold = element("div", "weaker" + (state.showWeaker ? " open" : "") + (state.selection === WEAKER ? " selected" : ""));
    fold.dataset.id = WEAKER;
    fold.setAttribute("role", "option");
    fold.innerHTML = ICONS.chevron;
    const count = state.weaker.length;
    fold.append(state.showWeaker ? "Weaker matches" : `${count} weaker ${count === 1 ? "match" : "matches"}`);
    fold.onmousedown = (event) => event.preventDefault();
    fold.onclick = toggleWeaker;
    $list.append(fold);
    if (state.showWeaker) for (const hit of state.weaker) $list.append(row(hit, true));
  }
  $list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
}

function row(hit, weaker) {
  const selected = state.selection === hit.path;
  const item = element("div", "row" + (selected ? " selected" : "") + (weaker ? " weaker-row" : ""));
  item.dataset.id = hit.path;
  item.setAttribute("role", "option");
  item.setAttribute("aria-selected", String(selected));
  item.setAttribute("aria-label", `${KIND_TITLE[hit.kind] || "File"}, ${nameOf(hit.path)}, ${reasonOf(hit)}`);
  item.append(thumbnail(hit, item));
  const text = element("div", "row-text");
  const title = element("div", "row-title");
  title.append(nameLine(nameOf(hit.path)));
  const place = placeOf(hit);
  if (place) title.append(placeBadge(place));
  // The words found, where keyword search found them; else where the file is.
  let sub;
  if (hit.excerpt && hit.keyword_rank != null && hit.kind !== "code") {
    sub = element("div", "row-sub");
    sub.innerHTML = marked(hit.excerpt);
  } else {
    sub = folderLine(folderOf(hit));
    sub.classList.add("row-sub");
  }
  text.append(title, sub);
  item.append(text);
  wireResult(item, hit, {
    select: (chosen) => {
      state.navigated = true;
      select(chosen.path);
      // On Linux a row's press can't be kept from the field (WebKit drags from it): the cursor goes back.
      if (document.activeElement !== $query) $query.focus();
    },
    open: openHit,
    reveal: revealHit,
  });
  return item;
}

/// A picture of the file for its row: the picture itself, a video's frame at the moment, a PDF's page, all small from
/// the helper (a full-size photo per row would cost the web view hundreds of MB); else the shell's icon of the file
/// (code always: a page of tiny text says less than its type's icon).
function thumbnail(hit, item) {
  const what = hit.kind === "code" ? null : renderOf(hit);
  if (!what) return iconOf(hit, 36, "thumb icon");
  const image = element("img", "thumb");
  image.alt = "";
  rendered(hit.path, what[0], what[1], Math.round(36 * (window.devicePixelRatio || 1)))
    .then((path) => {
      image.src = fileURL(path);
      item.dataset.thumb = path;   // the picture under the pointer when it's dragged out
    })
    .catch(() => image.replaceWith(iconOf(hit, 36, "thumb icon")));
  return image;
}

function renderPreview() {
  stopPlaying();
  $preview.replaceChildren();
  $message.hidden = true;
  $preview.hidden = false;
  if (state.phase === "codeHint" || state.phase === "codeOff") return showMessage(codeHint());
  if (!state.strong.length && !state.weaker.length) {
    if (state.phase === "words") {
      // The words are in and the meaning results on their way (as on the Mac): no verdict yet.
      return showMessage(message(null, "Searching…"));
    }
    if (!state.hasFolders) {
      return showMessage(message("No folders chosen yet", "DigUp only searches the folders you pick.",
                                 button("Choose Folders…", () => invoke("choose_folders").catch(failed))));
    }
    if (state.isCode) {
      return showMessage(message("No good matches in your code", "Try saying what the code does, or a name that's in it."));
    }
    return showMessage(message("No good matches", "Try what you'd see or hear in it, or words you remember from it."));
  }
  if (state.selection === WEAKER) {
    const count = state.weaker.length;
    const box = message(state.showWeaker ? "Weaker matches" : `${count} weaker ${count === 1 ? "match" : "matches"}`,
      "They match much less well than the results above. Press Enter to " + (state.showWeaker ? "fold them away." : "show them."));
    box.classList.add("explainer");
    box.insertAdjacentHTML("afterbegin", '<svg class="explainer-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/>'
      + '<path d="M7.5 9 H16.5 M9 12 H15 M10.5 15 H13.5"/></svg>');
    $preview.append(box);
    return;
  }
  const hit = selectedHit();
  if (!hit) return;
  // "Open at 0:06" once the shell says the recording's app takes the moment.
  learnOpener(hit).then((changed) => {
    if (!changed || selectedHit() !== hit) return;
    renderPreview();
    renderFooter();
  });
  $preview.append(
    previewPicture(hit, { query: state.text, open: openHit, ...PICTURE, small: 36 }),
    facts(hit, revealHit), why(hit), element("div", "spacer"), previewActions(hit, openHit, revealHit));
}

/// What shows across the whole panel instead of the list and the preview.
function showMessage(box) {
  $list.hidden = true;
  $preview.hidden = true;
  $message.hidden = false;
  $message.replaceChildren(box);
}

/// "code:" typed: what to type after it (examples to click), or without code folders how to turn code search on.
function codeHint() {
  const icon = element("div", "code-mark");
  icon.innerHTML = ICONS.code;
  if (state.phase === "codeOff") {
    const box = message("Code search is off", "DigUp can find code by what it does, in the folders you pick. Code gets "
      + "an index of its own and never shows up in other searches.",
      button("Choose Code Folders…", () => invoke("choose_code_folders").catch(failed)));
    box.prepend(icon);
    return box;
  }
  const examples = element("div", "code-examples");
  for (const example of CODE_EXAMPLES) {
    const chip = element("button", "code-example", example);
    chip.onmousedown = (event) => event.preventDefault();
    chip.onclick = () => {
      $query.value = example;
      queryChanged();
    };
    examples.append(chip);
  }
  const box = message("Search your code", "Say what the code does, or type a name that's in it.");
  box.prepend(icon);
  box.append(examples);
  return box;
}

function message(title, text, action) {
  const box = element("div", "message");
  if (title) box.append(element("strong", "", title));
  box.append(element("span", "", text));
  if (action) box.append(action);
  return box;
}

function button(title, action) {
  const node = element("button", "f-button", title);
  node.onmousedown = (event) => event.preventDefault();
  node.onclick = action;
  return node;
}

function renderFooter() {
  $summary.textContent = summaryText();
  $keys.textContent = keysText();
}

/// The footer's left: "Copied …" for a moment, how the search goes, or what it found ("12 results · 3 weaker").
function summaryText() {
  if (state.note) return state.note;
  if (state.error) return `DigUp's helper: ${state.error}`;
  switch (state.phase) {
    case "words":
      return state.encoder === "starting" ? "Matching words; meaning search is warming up…" : "Matching words…";
    case "wordsOnly":
      return state.meaningUnavailable ?? "Words only: meaning search isn't available";
    case "codeHint":
      return "Searching your code";
    case "codeOff":
      return "Code search is off";
  }
  if (state.isCode && state.codeIndexing?.total > 0) {
    const { done, total } = state.codeIndexing;
    return `Still reading code (${Math.trunc(done / total * 100)}%): some isn't in yet`;
  }
  // Results while indexing (or before the model is in) may be missing some: that, where they're counted.
  if (!state.isCode && state.caveat) return state.caveat;
  const count = state.strong.length, weaker = state.weaker.length;
  return `${count} ${count === 1 ? "result" : "results"}` + (state.isCode ? " in your code" : "")
    + (weaker ? ` · ${weaker} weaker` : "");
}

/// The keys, saying where Enter and Space go for a page or moment: "↩ Open at 0:06   ␣ Preview at 0:06", and for code
/// at which line: "↩ Open in Visual Studio Code at line 12".
function keysText() {
  const hit = selectedHit();
  const reveal = `${MOD}↩ Show in ${FILE_MANAGER}`;
  if (hit?.kind === "code") {
    const line = hit.segment === "lines" ? ` at line ${codeLine(hit)}` : "";
    return `↩ ${openTitle(hit)}${line}   ${reveal}   ␣ Preview   ${MOD}C Copy`;
  }
  const jump = hit && jumpOf(hit);
  return `↩ ${hit ? openTitle(hit) : "Open"}   ${reveal}   ␣ Preview${jump ? ` at ${jump}` : ""}   ${MOD}C Copy`;
}

// MARK: The big preview (Space, as Quick Look on the Mac)

const $big = element("div", "big");
$big.hidden = true;
$panel.append($big);

/// Space, once a result is chosen with the arrows or a click: the panel at its tallest with the result over all of
/// it, a video playing from its moment. Space or Esc puts it away; the arrows go on through the results under it.
function toggleBig() {
  if (!$big.hidden) return closeBig();
  stopPlaying();
  $big.hidden = false;
  $panel.classList.add("big-open");
  renderBig();
  render();
}

function closeBig() {
  if ($big.hidden) return;
  $big.hidden = true;
  $panel.classList.remove("big-open");
  $big.replaceChildren();   // its video or sound stops with it
  render();
}

function renderBig() {
  const hit = selectedHit();
  if (!hit) return closeBig();
  $big.replaceChildren(bigSheet(hit, { query: state.text, open: openHit, close: closeBig }));
}

// MARK: Keys and events

$query.addEventListener("input", queryChanged);
// A click back in the field: Space types again (after a click on a result, it previewed).
$query.addEventListener("mousedown", () => { state.navigated = false; });

document.addEventListener("keydown", (event) => {
  if (event.isComposing) return; // an input method is composing: its keys
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  const plain = !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey;
  const command = modifier && !event.altKey && !event.shiftKey;
  if (menuShown() && event.key === "Escape") {
    event.preventDefault();
    hideMenu();
    return;
  }
  switch (event.key) {
    case "Escape":
      event.preventDefault();
      if (!$big.hidden) closeBig();
      else dismiss();
      return;
    case " ":
      // After the arrows or a click: the big preview (or the weaker matches' fold). While typing: a space.
      if (!plain || !(state.navigated || !$big.hidden) || !state.selection) return;
      event.preventDefault();
      if (state.selection === WEAKER) toggleWeaker();
      else toggleBig();
      return;
    case "ArrowDown":
    case "ArrowUp":
      if (!plain) return;
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    case "Enter":
      if (state.selection === WEAKER && plain) {
        event.preventDefault();
        closeBig();
        toggleWeaker();
      } else if (command) {
        event.preventDefault();
        closeBig();
        revealHit(selectedHit());
      } else if (plain) {
        event.preventDefault();
        closeBig();
        openHit(selectedHit());
      }
      return;
  }
  if (command) {
    switch (event.key.toLowerCase()) {
      case "c": {
        // The file, except right after you selected some of the query's text (the panel opens with it selected).
        const hit = state.selection === WEAKER ? null : selectedHit();
        if (copyResult(event, hit, state.navigated)) copied(hit);
        return;
      }
      case "o":
        event.preventDefault();
        openInWindow();
        return;
      case "y":
        // Ctrl+Y, as ⌘Y on the Mac: the big preview, whether or not you've arrowed.
        if (!state.selection || state.selection === WEAKER) return;
        event.preventDefault();
        toggleBig();
        return;
      case ",":
        event.preventDefault();
        invoke("open_settings", {}).catch(failed);
        return;
      case "n":
        // New Search: the window, empty.
        event.preventDefault();
        invoke("open_window", { query: "", kind: null }).catch(failed);
        return;
    }
  }
  // Typing anywhere goes to the field.
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && document.activeElement !== $query
      && !window.getSelection()?.toString()) {
    $query.focus();
  }
});

/// Shown (again): it fades in, slightly rising, from wherever a fade out got to.
function fadeIn() {
  clearTimeout(hideTimer);
  hideTimer = null;
  const hiding = $panel.classList.contains("hiding");
  $panel.classList.remove("hiding");
  if (hiding) return;
  $panel.classList.add("entering");
  requestAnimationFrame(() => requestAnimationFrame(() => $panel.classList.remove("entering")));
}

// The shell is hiding the panel (a result opened, another app took the focus): the same fade as Esc, without asking.
tauri.event.listen("panel-hiding", () => {
  clearTimeout(hideTimer);
  hideTimer = null;
  $panel.classList.add("hiding");
});

tauri.event.listen("panel-shown", () => {
  closeBig();
  hideMenu();
  fadeIn();
  // Like Spotlight: the last query, selected.
  $query.focus();
  $query.select();
  state.navigated = false;
  ask({ op: "prewarm" }).catch(() => {});
});

tauri.event.listen("helper", ({ payload }) => {
  const { from, event } = payload;
  if (from === "search" && event.event === "encoder") {
    state.encoder = event.state;
    renderField();
    if (state.phase !== "empty") renderFooter();
  }
});

/// Indexing and the model, from the shell: a badge beside the field while results may be incomplete ("Indexing 42%"),
/// as the Mac's panel has, with its progress as a ring.
function showState(app) {
  const hadCode = state.hasCode, hadFolders = state.hasFolders;
  state.hasCode = app.hasCode !== false;
  state.hasFolders = app.hasFolders !== false;
  state.caveat = app.caveat || null;
  state.meaningUnavailable = app.model?.state && app.model.state !== "ready" ? app.caveat || null : null;
  state.codeIndexing = app.codeIndexing || null;
  opening.editor = app.editor || null;
  $activity.hidden = !app.badge;
  if (app.badge) {
    const length = 2 * Math.PI * 4.6, done = Math.max(0.02, Math.min(1, app.progress ?? 0));
    $activity.innerHTML = app.progress == null ? "" : `<svg viewBox="0 0 12 12"><circle class="track" cx="6" cy="6" `
      + `r="4.6"/><circle class="done" cx="6" cy="6" r="4.6" stroke-dasharray="${(length * done).toFixed(2)} ${length.toFixed(2)}"/></svg>`;
    $activity.append(app.badge);
    $activity.title = app.line || "";
  }
  renderField();
  // Code search turned on or off, or the first folders chosen: the query's state changes with it.
  if (state.hasCode !== hadCode && state.isCode) return queryChanged();
  if (state.phase === "empty") return;
  if (state.hasFolders !== hadFolders && !state.strong.length && !state.weaker.length) renderPreview();
  renderFooter();
}

tauri.event.listen("state", ({ payload }) => showState(payload));
invoke("app_state").then((app) => app && showState(app)).catch(() => {});

// Debug runs (--debug-query): type the query in, and once the meaning results and their pictures are in, report
// what the panel shows.
function debugSearch(query) {
  if (!query) return;
  debugPending = true;
  $query.value = query;
  queryChanged();
}
invoke("debug_query").then(debugSearch);
tauri.event.listen("debug-query", ({ payload }) => debugSearch(payload));   // after setup's first index

function report() {
  debugPending = false;
  // Dev snapshots (index.html?big): the selected result's big preview, as Space shows it.
  if (new URLSearchParams(location.search).has("big")) toggleBig();
  setTimeout(async () => {
    const big = $preview.querySelector(".frame img, video, audio, .passage, .code-lines, .audio-moment");
    const media = big && (big.tagName === "AUDIO" || big.tagName === "VIDEO");
    // A sound or a video plays through GStreamer on Linux: wait until it has read the file's metadata, or failed.
    if (media && big.readyState < 1 && !big.error) {
      await new Promise((resolve) => {
        big.addEventListener("loadedmetadata", resolve, { once: true });
        big.addEventListener("error", resolve, { once: true });
        setTimeout(resolve, 30000);
      });
    }
    const thumbs = [...$list.querySelectorAll("img.thumb")];
    invoke("debug_report", {
      report: {
        query: $query.value,
        phase: state.phase,
        groups: state.groups.map((group) => ({ title: group.title, rows: group.rows.map((hit) => nameOf(hit.path)) })),
        weaker: state.weaker.length,
        selected: state.selection && nameOf(state.selection),
        preview: big && {
          tag: big.tagName.toLowerCase(),
          loaded: big.tagName === "IMG" ? big.complete && big.naturalWidth > 0 : media ? big.readyState >= 1 : null,
          error: media && big.error ? big.error.code : null,
          size: big.tagName === "IMG" ? `${big.naturalWidth}x${big.naturalHeight}` : null,
          text: big.tagName === "IMG" ? null : big.textContent.slice(0, 80),
        },
        thumbnails: `${thumbs.filter((image) => image.complete && image.naturalWidth > 0).length} of ${thumbs.length} drawn`,
        facts: [...$preview.querySelectorAll(".facts .title, .facts .folder, .facts .details, .why .reason span")]
          .map((node) => node.textContent),
        footer: [$summary.textContent, $keys.textContent],
      },
    }).catch(() => {});
  }, 1500);
}
