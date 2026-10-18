// DigUp's Settings window, its tabs after the Mac app's (Sources/DigUpApp/SettingsWindow.swift), in Windows 11's look:
// a SelectorBar of tabs, SettingsCards, ContentDialogs for what the Mac asks in a confirmation or a sheet.
// General: the shortcut, opening at login, the tray click and centering the panel where the desktop places windows
// itself (it costs memory, so it's a choice), the model on the processor, and updates. Folders: how indexing goes (with
// Pause), each folder searched and how far along it is, Add Folders… (AddFolders.swift's sheet), the folders and file
// types skipped, battery and the set hours. Code: code search's folders, the editor its results open in, turning it
// off. Storage: the model (with Download, Use Files… and Copy Links while it isn't in), the index, privacy.
"use strict";

const tauri = window.__TAURI__;
const invoke = (command, args) => tauri.core.invoke(command, args);
const ask = (request) => invoke("ask", { request });
const isWindows = /Win/.test(navigator.platform);
const $ = (id) => document.getElementById(id);

const notes = {
  gnome: "DigUp added it to GNOME's keyboard shortcuts. To change it: Settings → Keyboard → View and Customize " +
    "Shortcuts → Custom Shortcuts.",
  kde: "DigUp added it to KDE's shortcuts. To change it: System Settings → Shortcuts → DigUp.",
  by_hand: "This desktop doesn't let apps set their own shortcuts. To open the panel with one, add a shortcut in its " +
    "keyboard settings that runs:",
};

let info = {};
let summaries = null;        // what's indexed under each folder (search-service's summaries)
let codeSummaries = null;    // what's indexed under each code folder

// MARK: Icons (Fluent System Icons, MIT): [size, path]

const ICONS = {
  keyboard: [20, "M5 12.5c0-.28.22-.5.5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5M11.5 8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5m3.75-.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0M5.5 8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5m2.25 1.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0m2.25.75A.75.75 0 1 0 10 9a.75.75 0 0 0 0 1.5m3.76-.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0M8.5 8a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5M2 5.5C2 4.67 2.67 4 3.5 4h13c.83 0 1.5.67 1.5 1.5v8c0 .83-.67 1.5-1.5 1.5h-13A1.5 1.5 0 0 1 2 13.5zM3.5 5a.5.5 0 0 0-.5.5v8c0 .28.22.5.5.5h13a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5z"],
  power: [20, "M10.5 2.5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0zM13.74 4a.5.5 0 1 0-.5.87 6.5 6.5 0 1 1-6.49 0 .5.5 0 1 0-.5-.87 7.5 7.5 0 1 0 7.5 0"],
  desktop: [20, "M4 2a2 2 0 0 0-2 2v9c0 1.1.9 2 2 2h3v2H5.5a.5.5 0 0 0 0 1h9a.5.5 0 0 0 0-1H13v-2h3a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm8 13v2H8v-2zM3 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"],
  center: [20, "M3.5 18a.5.5 0 0 1-.5-.5v-15a.5.5 0 0 1 1 0v15a.5.5 0 0 1-.5.5 M16 17.5a.5.5 0 0 0 1 0v-15a.5.5 0 0 0-1 0z M9 4a2 2 0 0 0-2 2v8c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM8 6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z"],
  processor: [20, "M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6m-2 3a2 2 0 1 1 4 0 2 2 0 0 1-4 0m-.5-8c.28 0 .5.22.5.5V4h1.5V2.5a.5.5 0 0 1 1 0V4H12V2.5a.5.5 0 0 1 1 0V4h.5A2.5 2.5 0 0 1 16 6.5V7h1.5a.5.5 0 0 1 0 1H16v1.5h1.5a.5.5 0 0 1 0 1H16V12h1.5a.5.5 0 0 1 0 1H16v.5a2.5 2.5 0 0 1-2.5 2.5H13v1.5a.5.5 0 0 1-1 0V16h-1.5v1.5a.5.5 0 0 1-1 0V16H8v1.5a.5.5 0 0 1-1 0V16h-.5A2.5 2.5 0 0 1 4 13.5V13H2.5a.5.5 0 0 1 0-1H4v-1.5H2.5a.5.5 0 0 1 0-1H4V8H2.5a.5.5 0 0 1 0-1H4v-.5A2.5 2.5 0 0 1 6.5 4H7V2.5c0-.28.22-.5.5-.5M15 6.5c0-.83-.67-1.5-1.5-1.5h-7C5.67 5 5 5.67 5 6.5v7c0 .83.67 1.5 1.5 1.5h7c.83 0 1.5-.67 1.5-1.5z"],
  sync: [20, "M11.41 3.64a.5.5 0 0 0 0-.71L9.3.8a.5.5 0 0 0-.7.7l1 1a7.5 7.5 0 0 0-4.08 13.5.5.5 0 0 0 .6-.8A6.5 6.5 0 0 1 10.14 3.5L8.59 5.04a.5.5 0 0 0 .7.7zM8.6 16.36a.5.5 0 0 0 0 .71l2.12 2.12a.5.5 0 0 0 .7-.7l-1-1a7.5 7.5 0 0 0 4.07-13.5.5.5 0 1 0-.59.8q.37.28.7.61a6.5 6.5 0 0 1-4.73 11.1l1.55-1.55a.5.5 0 1 0-.7-.7z"],
  update: [20, "M15.5 17a.5.5 0 0 1 .09 1H4.5a.5.5 0 0 1-.09-1H15.5M10 2a.5.5 0 0 1 .5.41V14.3l3.64-3.65a.5.5 0 0 1 .64-.06l.07.06c.17.17.2.44.06.63l-.06.07-4.5 4.5a.5.5 0 0 1-.25.14L10 16a.5.5 0 0 1-.4-.2l-4.46-4.45a.5.5 0 0 1 .64-.76l.07.06 3.65 3.64V2.5c0-.27.22-.5.5-.5"],
  battery: [20, "M6.32 6H3a2 2 0 0 0-2 2v4c0 1.1.9 2 2 2h13a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.33l.1-.18q.2-.42.1-.82H16a3 3 0 0 1 3 3 1 1 0 0 1 1 1v2a1 1 0 0 1-1 1 3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h3.83zm3.05-3.82c.16-.3.63-.2.63.15V5h1.64c.2 0 .32.2.23.37L9.62 9.82c-.15.3-.62.2-.62-.15V7H7.35a.26.26 0 0 1-.22-.37z"],
  clock: [20, "M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16m0 1a7 7 0 1 0 0 14 7 7 0 0 0 0-14m-.5 2a.5.5 0 0 1 .5.41V10h2.5a.5.5 0 0 1 .09 1H9.5a.5.5 0 0 1-.5-.41V5.5c0-.28.22-.5.5-.5"],
  code: [20, "M12.64 1.02a.5.5 0 0 1 .34.62l-5 17a.5.5 0 0 1-.96-.28l5-17a.5.5 0 0 1 .62-.34M5.13 5.17a.5.5 0 0 1 .74.66L2.17 10l3.7 4.17a.5.5 0 0 1-.74.66l-4-4.5a.5.5 0 0 1 0-.66zm9.04-.04a.5.5 0 0 1 .7.04l4 4.5a.5.5 0 0 1 0 .66l-4 4.5a.5.5 0 0 1-.74-.66l3.7-4.17-3.7-4.17a.5.5 0 0 1 .04-.7"],
  open: [20, "M6 4a2 2 0 0 0-2 2v8c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2v-2.5a.5.5 0 0 1 1 0V14a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h2.5a.5.5 0 0 1 0 1zm5-.5c0-.28.22-.5.5-.5h5c.28 0 .5.22.5.5v5a.5.5 0 0 1-1 0V4.7l-4.15 4.15a.5.5 0 0 1-.7-.7L15.29 4H11.5a.5.5 0 0 1-.5-.5"],
  shield: [20, "M9.72 2.08a.5.5 0 0 1 .56 0q2.9 1.94 6.3 2.43A.5.5 0 0 1 17 5v4.5c0 3.9-2.3 6.73-6.82 8.47a.5.5 0 0 1-.36 0C5.31 16.23 3 13.39 3 9.5V5a.5.5 0 0 1 .43-.5 15 15 0 0 0 6.3-2.42M9.6 3.35A16 16 0 0 1 4 5.43V9.5c0 3.4 1.97 5.86 6 7.46 4.03-1.6 6-4.07 6-7.46V5.43a16 16 0 0 1-5.6-2.08L10 3.1z"],
  info: [20, "M10.5 8.91a.5.5 0 0 0-1 .09v4.6a.5.5 0 0 0 1-.1V8.91m.3-2.16a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0M3 10a7 7 0 1 1 14 0 7 7 0 0 1-14 0"],
  error: [20, "M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16m0 10.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5M10 6a.5.5 0 0 0-.5.41v4.68a.5.5 0 0 0 1 0V6.41A.5.5 0 0 0 10 6"],
  add: [16, "M8 2c.28 0 .5.22.5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5c0-.28.22-.5.5-.5"],
  dismiss: [16, "m2.59 2.72.06-.07a.5.5 0 0 1 .63-.06l.07.06L8 7.29l4.65-4.64a.5.5 0 0 1 .7.7L8.71 8l4.64 4.65c.18.17.2.44.06.63l-.06.07a.5.5 0 0 1-.63.06l-.07-.06L8 8.71l-4.65 4.64a.5.5 0 0 1-.7-.7L7.29 8 2.65 3.35a.5.5 0 0 1-.06-.63l.06-.07z"],
  remove: [16, "M2 8a6 6 0 1 1 12 0A6 6 0 0 1 2 8m6-7a7 7 0 1 0 0 14A7 7 0 0 0 8 1M5 7.5a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1z"],
  chevron: [12, "M4.65 2.15a.5.5 0 0 0 0 .7L7.79 6 4.65 9.15a.5.5 0 1 0 .7.7l3.5-3.5a.5.5 0 0 0 0-.7l-3.5-3.5a.5.5 0 0 0-.7 0"],
  link: [16, "M4.5 3C3.67 3 3 3.67 3 4.5v7c0 .83.67 1.5 1.5 1.5h7c.83 0 1.5-.67 1.5-1.5V9.27a.5.5 0 0 1 1 0v2.23a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5v-7A2.5 2.5 0 0 1 4.5 2h2.23a.5.5 0 0 1 0 1zm4.27-.5c0-.28.22-.5.5-.5h4.23c.28 0 .5.22.5.5v4.23a.5.5 0 0 1-1 0V3.71L9.62 7.08a.5.5 0 1 1-.7-.7L12.29 3H9.27a.5.5 0 0 1-.5-.5"],
  screenshot: [16, "M2 4.5A2.5 2.5 0 0 1 4.5 2h7A2.5 2.5 0 0 1 14 4.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5zM4.5 3C3.67 3 3 3.67 3 4.5v7c0 .83.67 1.5 1.5 1.5h7c.83 0 1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm.75 2a.25.25 0 0 0-.25.25V6.5a.5.5 0 0 1-1 0V5.25C4 4.56 4.56 4 5.25 4H6.5a.5.5 0 0 1 0 1zM5 10.75c0 .14.11.25.25.25H6.5a.5.5 0 0 1 0 1H5.25C4.56 12 4 11.44 4 10.75V9.5a.5.5 0 0 1 1 0zM10.75 5c.14 0 .25.11.25.25V6.5a.5.5 0 0 0 1 0V5.25C12 4.56 11.44 4 10.75 4H9.5a.5.5 0 0 0 0 1zm.25 5.75q-.02.23-.25.25H9.5a.5.5 0 0 0 0 1h1.25c.69 0 1.25-.56 1.25-1.25V9.5a.5.5 0 0 0-1 0z"],
  image: [16, "M11.5 5.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0M2 4.5A2.5 2.5 0 0 1 4.5 2h7A2.5 2.5 0 0 1 14 4.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5zM4.5 3C3.67 3 3 3.67 3 4.5v7q0 .35.15.65L6.8 8.49a1.7 1.7 0 0 1 2.4 0l3.65 3.66q.15-.3.15-.65v-7c0-.83-.67-1.5-1.5-1.5zm7.65 9.85L8.5 9.2a.7.7 0 0 0-1 0l-3.65 3.65q.3.15.65.15h7q.35 0 .65-.15"],
  pdf: [16, "M2.5 10a1.5 1.5 0 0 1 0 3H2v1.5a.5.5 0 0 1-1 0v-4c0-.28.22-.5.5-.5zM2 12h.5a.5.5 0 0 0 0-1H2zm4-2c.83 0 1.5.67 1.5 1.5v2c0 .83-.67 1.5-1.5 1.5H5a.5.5 0 0 1-.5-.5v-4c0-.28.22-.5.5-.5zm-.5 4H6a.5.5 0 0 0 .5-.5v-2A.5.5 0 0 0 6 11h-.5zm5.5-4a.5.5 0 0 1 0 1H9.5v1h1a.5.5 0 0 1 0 1h-1v1.5a.5.5 0 0 1-1 0v-4c0-.28.22-.5.5-.5zM9.59 1c.39 0 .78.16 1.06.44l2.91 2.91c.28.28.44.67.44 1.06V13a2 2 0 0 1-2 2h-1.59q.09-.24.09-.5V14H12a1 1 0 0 0 1-1V6h-2.5A1.5 1.5 0 0 1 9 4.5V2H6a1 1 0 0 0-1 1v6q-.58.02-1 .38V3c0-1.1.9-2 2-2zM10 4.5c0 .28.22.5.5.5h2.29L10 2.21z"],
  doc: [16, "M3 3c0-1.1.9-2 2-2h3.59c.4 0 .78.16 1.06.44l2.91 2.91c.28.28.44.67.44 1.06V13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6H9.5A1.5 1.5 0 0 1 8 4.5V2zm4.5 3h2.3L9 2.2v2.3c0 .28.22.5.5.5m-4 3a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1zM5 10.5c0-.28.22-.5.5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m.5 1.5a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1z"],
  audio: [16, "M12 5.21v5.06A2 2 0 1 0 13 12V1.93a.8.8 0 0 0-1.07-.76l-6.4 2.29A.8.8 0 0 0 5 4.2v7.06A2 2 0 1 0 6 13V7.35zm0-1.06L6 6.29V4.35l6-2.14zM11 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2m-7 1a1 1 0 1 1 0 2 1 1 0 0 1 0-2"],
  video: [16, "M3.5 3A2.5 2.5 0 0 0 1 5.5v5A2.5 2.5 0 0 0 3.5 13h5a2.5 2.5 0 0 0 2.5-2.5v-.13l2.04 1.4c.82.58 1.96-.01 1.96-1.02v-5.5c0-1-1.14-1.6-1.96-1.03L11 5.62V5.5A2.5 2.5 0 0 0 8.5 3zM11 6.84l2.6-1.8c.17-.1.4.01.4.21v5.5c0 .2-.23.32-.4.2L11 9.16zM2 5.5C2 4.67 2.67 4 3.5 4h5c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5h-5A1.5 1.5 0 0 1 2 10.5z"],
  codeFile: [16, "M10.03 1.32a.5.5 0 0 1 .94.36l-5 13a.5.5 0 0 1-.94-.36zM3.65 4.65a.5.5 0 0 1 .7.7L1.71 8l2.64 2.65a.5.5 0 0 1-.7.7l-3-3a.5.5 0 0 1 0-.7zm8 0c.2-.2.5-.2.7 0l3 3c.2.2.2.5 0 .7l-3 3a.5.5 0 0 1-.7-.7L14.29 8l-2.64-2.65a.5.5 0 0 1 0-.7"],
};

function icon(name) {
  const [size, path] = ICONS[name];
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true"><path d="${path}"/></svg>`;
}

function iconElement(name, className) {
  const span = element("span", className);
  span.dataset.icon = name;
  span.innerHTML = icon(name);
  return span;
}

for (const node of document.querySelectorAll("[data-icon]")) node.innerHTML = icon(node.dataset.icon);

/// A folder until the shell has its own icon (Explorer's, from `file_icon`): Windows 11's yellow one.
const FOLDER = '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#e3a21a" d="M3 8.5A3.5 3.5 0 0 1 6.5 5h5.7a2 2 0 0 1 1.4.58L16 8h9.5A3.5 3.5 0 0 1 29 11.5v12a3.5 3.5 0 0 1-3.5 3.5h-19A3.5 3.5 0 0 1 3 23.5z"/><path fill="#ffc83d" d="M3 13a2 2 0 0 1 2-2h22a2 2 0 0 1 2 2v10.5a3.5 3.5 0 0 1-3.5 3.5h-19A3.5 3.5 0 0 1 3 23.5z"/></svg>';
const fileIcons = new Map();   // "path@size" → a data: URL, null (none: the folder above), or the request for it

/// A folder's icon, `size` pixels square (dimmed when it isn't connected).
function folderIcon(path, size, missing = false) {
  const box = element("span", "folder-icon" + (missing ? " missing" : ""));
  box.innerHTML = FOLDER;
  if (missing) return box;
  const show = (url) => {
    if (!url) return;
    const image = new Image();
    image.alt = "";
    image.src = url;
    box.replaceChildren(image);
  };
  const id = `${key(path)}@${size}`;
  const known = fileIcons.get(id);
  if (typeof known === "string") {
    show(known);
  } else if (known === undefined) {
    const request = invoke("file_icon", { path: native(path), size: Math.round(size * (window.devicePixelRatio || 1)) })
      .catch(() => null)
      .then((url) => {
        fileIcons.set(id, typeof url === "string" ? url : null);
        return url;
      });
    fileIcons.set(id, request);
    request.then(show);
  } else if (known) {
    known.then(show);
  }
  return box;
}

// MARK: Tabs (a SelectorBar: arrows move between them; Ctrl+Tab and Ctrl+Page Down go to the next one anywhere)

const TABS = ["general", "folders", "code", "storage"];
const tabButtons = [...document.querySelectorAll("#tabs [role=tab]")];
let tab = "general";
let loaded = false;   // settings_info has answered

function showTab(name, focus = false) {
  if (!TABS.includes(name)) name = "general";
  const changed = name !== tab;
  tab = name;
  for (const button of tabButtons) {
    const selected = button.dataset.tab === name;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  for (const page of document.querySelectorAll(".page")) page.hidden = page.id !== name;
  if (changed) $("main").scrollTop = 0;
  if (!loaded) return;   // refresh() loads them
  if (name === "folders") loadSummaries();
  if (name === "code") loadCodeSummaries();
}

for (const button of tabButtons) button.addEventListener("click", () => showTab(button.dataset.tab));

$("tabs").addEventListener("keydown", (event) => {
  const index = TABS.indexOf(tab);
  const to = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0,
               End: TABS.length - 1 }[event.key];
  if (to == null) return;
  event.preventDefault();
  showTab(TABS[(to + TABS.length) % TABS.length], true);
});

document.addEventListener("keydown", (event) => {
  if (openDialog || recording) return;
  const step = (event.ctrlKey && event.key === "Tab") ? (event.shiftKey ? -1 : 1)
    : event.ctrlKey && event.key === "PageDown" ? 1 : event.ctrlKey && event.key === "PageUp" ? -1 : 0;
  if (step) {
    event.preventDefault();
    showTab(TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length], document.activeElement?.closest?.("#tabs") != null);
  } else if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "w") {
    event.preventDefault();
    invoke("close_window").catch(() => {});
  }
});

// Another screen asks for a tab (open_settings { tab }: the window's status line, the panel, the tray).
tauri.event.listen("settings-tab", ({ payload }) => showTab(String(payload || "general")));

// MARK: General

let loginProblem = null;

function renderGeneral() {
  $("login-group").hidden = !info.canOpenAtLogin;
  $("login").checked = Boolean(info.openAtLogin);
  renderLogin();
  $("tray-click-option").hidden = !info.canChooseTrayClick;
  $("tray-click").value = info.trayClick === "panel" ? "panel" : "window";
  $("center-option").hidden = !info.canCenter;
  $("center").checked = Boolean(info.centered);
  $("processor").checked = Boolean(info.processorOnly);
  renderShortcut();
  renderUpdates();
}

/// "So the shortcut always works.", or why login couldn't be changed, in red, as the Mac says it.
function renderLogin() {
  $("login-info").textContent = loginProblem || "So the shortcut always works.";
  $("login-info").classList.toggle("problem-text", Boolean(loginProblem));
}

$("login").addEventListener("change", async () => {
  const on = $("login").checked;
  hideProblem();
  try {
    await invoke("set_open_at_login", { on });
    info.openAtLogin = on;
    loginProblem = null;
  } catch (error) {
    $("login").checked = !on;
    loginProblem = String(error);
  }
  renderLogin();
});

/// Updates: the daily check, and this version or the one waiting (updates.rs).
function renderUpdates() {
  $("update-checks").checked = Boolean(info.updateChecks);
  $("update-info").textContent = "Once a day DigUp asks GitHub for its newest version; nothing about your files is sent. "
    + (info.installsUpdates ? "Updates install with one click."
      : "A new version is downloaded from its release page and installed as this one was.");
  const update = info.state && info.state.update;
  const version = $("update-version");
  version.classList.toggle("available", Boolean(update));
  version.disabled = !update;
  version.textContent = !update ? `DigUp ${info.version || ""}`
    : update.state === "downloading" ? `Downloading DigUp ${update.version}…` + (update.percent != null ? ` ${update.percent}%` : "")
    : update.state === "installing" ? `Installing DigUp ${update.version}…` : `DigUp ${update.version} is available`;
}

$("licenses").onclick = () => invoke("open_licenses").catch(fail);

$("update-version").onclick = () => {
  if (info.state && info.state.update) invoke("offer_update").catch(fail);
};
$("check-now").onclick = async () => {
  hideProblem();
  $("check-now").disabled = true;
  try {
    await invoke("check_for_updates");
  } catch (error) {
    fail(error);
  }
  $("check-now").disabled = false;
};

/// A switch: the shell does it, or it goes back and says why.
function wire(box, command, apply) {
  box.addEventListener("change", async () => {
    hideProblem();
    try {
      await invoke(command, { on: box.checked });
      if (apply) apply(box.checked);
    } catch (error) {
      box.checked = !box.checked;
      fail(error);
    }
  });
}

wire($("center"), "set_center_panel", (on) => { info.centered = on; });
wire($("processor"), "set_processor_only", (on) => { info.processorOnly = on; });
wire($("update-checks"), "set_update_checks", (on) => { info.updateChecks = on; });
wire($("battery"), "set_index_on_battery", (on) => { info.indexOnBattery = on; });
$("tray-click").addEventListener("change", () => {
  const click = $("tray-click").value;
  hideProblem();
  invoke("set_tray_click", { click }).then(() => { info.trayClick = click; }).catch((error) => {
    $("tray-click").value = info.trayClick === "panel" ? "panel" : "window";
    fail(error);
  });
});

// MARK: The shortcut (the Mac's ShortcutRecorder; where DigUp grabs it itself, Windows and X11, shortcut.js records it)
// Click the keycaps, press the new shortcut; Esc cancels. A shortcut that can't be used says why, in red, and the
// recorder keeps listening.

let recording = false;
let shortcutProblem = null;

function renderShortcut() {
  const grab = info.shortcut?.method === "grab";
  const button = $("recorder");
  button.disabled = !grab;
  button.classList.toggle("recording", recording);
  if (recording) {
    button.replaceChildren(element("span", "", "Press the new shortcut…"));
  } else if (info.hotkey) {
    const keys = element("span", "keys");
    keys.id = "keys";
    keys.append(...info.hotkey.split("+").filter(Boolean).map((name) => element("span", "key", name)));
    button.replaceChildren(keys);
  } else {
    button.replaceChildren(element("span", "", "Click to set a shortcut"));
  }
  button.setAttribute("aria-label", recording ? "Recording a new shortcut"
    : grab ? `Shortcut ${info.hotkey || "none"}, click to change` : `Shortcut ${info.hotkey || "none"}`);
  const hint = $("recorder-hint");
  hint.hidden = !grab;
  hint.textContent = shortcutProblem || (recording ? "Esc cancels" : "Click to change");
  hint.classList.toggle("problem-text", Boolean(shortcutProblem));
  // GNOME, KDE and desktops without shortcuts for apps keep it in their own settings: where, as an InfoBar.
  const note = notes[info.shortcut?.method];
  $("shortcut-note-bar").hidden = !note;
  $("shortcut-note").textContent = note || "";
  $("shortcut-command").hidden = info.shortcut?.method !== "by_hand";
  $("shortcut-command").textContent = info.shortcut?.command || "";
}

function startRecording() {
  recording = true;
  hideProblem();
  renderShortcut();
  recordShortcut((text) => {
    // Its first words are what the recorder shows already; anything after is a problem with the keys pressed.
    if (!/^Press the new shortcut/.test(text)) shortcutProblem = text;
    renderShortcut();
  }, (shown, problem) => {
    if (shown) info.hotkey = shown;
    if (problem) {
      shortcutProblem = problem;
      startRecording();
      return;
    }
    recording = false;
    shortcutProblem = null;
    renderShortcut();
  });
}

$("recorder").addEventListener("click", () => {
  // A second click stops listening, as the Mac's does: shortcut.js stops on Esc, so it gets one.
  if (recording) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  else startRecording();
});

// MARK: Folders

/// How indexing goes: the status line, a bar while something's under way, the counts (and the model's download while
/// it runs), and Pause or Resume.
function renderStatus() {
  const state = info.state || {};
  $("status-line").textContent = state.line || "";
  $("status-bar").hidden = state.progress == null;
  $("status-fill").style.width = `${Math.round(100 * (state.progress || 0))}%`;
  let detail = `${(state.searchable || 0).toLocaleString()} of ${(state.files || 0).toLocaleString()} files searchable`;
  if (state.pending) detail += ` · ${state.pending.toLocaleString()} waiting`;
  if (state.unfinished) detail += ` · ${state.unfinished.toLocaleString()} long ${state.unfinished === 1 ? "file" : "files"} to finish`;
  if (modelActive(state.model)) detail += ` · model ${modelProgress(state.model)}`;
  $("status-detail").textContent = detail;
  $("pause").hidden = !info.folders?.length;
  $("pause").textContent = state.paused ? "Resume" : "Pause";
}

$("pause").onclick = () => invoke("pause_indexing", { paused: !(info.state || {}).paused }).catch(fail);

async function loadSummaries() {
  try {
    summaries = (await ask({ op: "summaries" }))?.roots || [];
  } catch {
    summaries = summaries || [];
  }
  renderFolders();
}

function renderFolders() {
  const rows = $("folder-rows");
  rows.replaceChildren();
  if (!info.folders?.length) {
    rows.append(element("div", "f-card empty", "No folders yet. Add the ones DigUp should search."));
  }
  for (const folder of info.folders || []) {
    const summary = (summaries || []).find((item) => same(item.path, folder)) || null;
    rows.append(folderRow(folder, summary));
  }
  const skipped = $("skipped-rows");
  skipped.replaceChildren();
  if (!info.skipped?.length) {
    skipped.append(element("div", "f-card empty",
      "None. Code projects, app bundles and caches are skipped anyway (code has its own tab)."));
  }
  for (const folder of info.skipped || []) {
    const row = element("div", "f-card skip-row");
    const path = element("div", "path", native(folder));
    path.title = native(folder);
    row.append(folderIcon(folder, 18), path, removeButton("Search this folder again", `Search ${nameOf(folder)} again`, () => {
      setSkipped(info.skipped.filter((other) => other !== folder));
    }));
    skipped.append(row);
  }
}

/// The fields: set from the settings when the window opens or they change, never while you're editing them.
function renderFields() {
  $("types").value = (info.skipTypes || []).join(", ");
  $("types-note").textContent = "DigUp only reads pictures, PDFs, documents (txt, md, rtf, docx, odt, html), audio and "
    + "video here; code is read only in the code folders (the Code tab). Keys, certificates and password files are "
    + `never read, nor are hidden folders like ${isWindows ? ".ssh" : "~/.ssh"}.`;
  $("battery").checked = info.indexOnBattery !== false;
  const hours = info.indexHours || { on: false, start: 60, end: 420 };
  $("hours").checked = hours.on;
  $("times").hidden = !hours.on;
  $("hours-start").value = clock(hours.start);
  $("hours-end").value = clock(hours.end);
}

/// A folder searched (with `code`, a code folder): its icon, name, where it is, what's in it, how much of it is
/// indexed, and Remove (FolderStatusRow).
function folderRow(folder, summary, code = false) {
  const row = element("div", "f-card folder-row");
  const missing = Boolean(summary?.missing);
  const text = element("div", "row-text");
  const name = element("div", "row-name", nameOf(folder));
  if (summary?.missing || summary?.unreadable) name.append(element("span", "flag", summary.missing ? "Not connected" : "No access"));
  const path = element("div", "path", native(folder));
  path.title = native(folder);
  text.append(name, path);
  if (summary && Object.values(summary.kinds || {}).some((count) => count > 0)) text.append(kindCounts(summary.kinds));
  const side = element("div", "side");
  if (summary) {
    side.append(element("div", "indexed", summary.missing || summary.unreadable ? "Kept for when it's back"
      : `${(summary.indexed || 0).toLocaleString()} of ${(summary.files || 0).toLocaleString()} indexed`));
    const states = [
      summary.pending ? `${summary.pending.toLocaleString()} waiting` : null,
      summary.unfinished ? `${summary.unfinished.toLocaleString()} long ${summary.unfinished === 1 ? "file" : "files"} to finish` : null,
      summary.skipped ? `${summary.skipped.toLocaleString()} skipped` : null,
      summary.failed ? `${summary.failed.toLocaleString()} couldn't be read` : null,
    ].filter(Boolean).join(" · ");
    if (states) side.append(element("div", "states", states));
  }
  row.append(folderIcon(folder, 32, missing), text, side,
             removeButton(code ? "Stop searching the code in this folder" : "Stop searching this folder",
                          `Remove ${nameOf(folder)}`, () => confirmRemoval(folder, summary, code)));
  return row;
}

/// "Stop searching “Pictures”?", as the Mac app asks: Remove, or Cancel.
async function confirmRemoval(folder, summary, code = false) {
  const count = summary?.files;
  const last = code && (info.code?.folders || []).length === 1;
  const files = count != null ? `Its ${count.toLocaleString()} ${code ? "code " : ""}${count === 1 ? "file leaves" : "files leave"}`
    : `Its ${code ? "code " : ""}files leave`;
  const ok = await confirmDialog({
    title: code ? `Stop searching the code in “${nameOf(folder)}”?` : `Stop searching “${nameOf(folder)}”?`,
    text: code ? `${files} the code index.${last ? " That turns code search off." : ""}`
      : `${files} the index. Adding it back later indexes them again.`,
    action: "Remove",
  });
  if (!ok) return;
  try {
    await invoke(code ? "remove_code_folder" : "remove_folder", { folder });
  } catch (error) {
    fail(error);
  }
  await refresh();
}

function removeButton(title, label, action) {
  const button = element("button", "f-button subtle remove");
  button.type = "button";
  button.append(iconElement("remove"));
  button.title = title;
  button.setAttribute("aria-label", label);
  button.onclick = action;
  return button;
}

async function setSkipped(skipped) {
  hideProblem();
  try {
    await invoke("set_skipped", { skipped });
  } catch (error) {
    fail(error);
  }
  await refresh();
}

$("add-folders").onclick = () => addFolders(false);
$("skip-folder").onclick = async () => {
  const picked = (await invoke("pick_folders")) || [];
  const skipped = info.skipped || [];
  if (picked.length) setSkipped([...skipped, ...picked.filter((path) => !skipped.some((other) => same(other, path)))]);
};

// File types: applied on Enter, and when the field is left.
async function applyTypes() {
  try {
    info.skipTypes = (await invoke("set_skip_types", { types: $("types").value })) || [];
    $("types").value = info.skipTypes.join(", ");
  } catch (error) {
    fail(error);
  }
}
$("types").addEventListener("keydown", (event) => { if (event.key === "Enter") applyTypes(); });
$("types").addEventListener("blur", applyTypes);

async function applyHours() {
  const on = $("hours").checked;
  const hours = { on, start: minutes($("hours-start").value, 60), end: minutes($("hours-end").value, 420) };
  $("times").hidden = !on;
  try {
    await invoke("set_index_hours", hours);
    info.indexHours = hours;
  } catch (error) {
    fail(error);
  }
}
$("hours").addEventListener("change", applyHours);
$("hours-start").addEventListener("change", applyHours);
$("hours-end").addEventListener("change", applyHours);

// MARK: Code

async function loadCodeSummaries() {
  if (!(info.code?.folders || []).length) {
    codeSummaries = [];
  } else {
    try {
      codeSummaries = (await ask({ op: "summaries", code: true }))?.roots || [];
    } catch {
      codeSummaries = codeSummaries || [];
    }
  }
  renderCode();
}

/// One line about the code index (AppModel.codeStatusLine): "812 code files indexed", "Indexing code 42% · …". The
/// code index's own progress is what its folders' summaries add up to.
function codeStatus() {
  const state = info.state || {};
  const total = { files: 0, indexed: 0, pending: 0 };
  for (const summary of codeSummaries || []) {
    for (const name of Object.keys(total)) total[name] += summary[name] || 0;
  }
  const count = (n) => `${n.toLocaleString()} code ${n === 1 ? "file" : "files"}`;
  if (!(info.code?.folders || []).length) return { line: "Code search is off" };
  if ((state.model || {}).state !== "ready") return { line: "Code is read once the model has downloaded" };
  const { pending, indexed, files } = total;
  if (pending > 0 && state.paused) return { line: `Paused · ${count(pending)} waiting` };
  if (pending > 0 && state.waitingFor) return { line: `${count(pending)} waiting · ${state.waitingFor}` };
  if (pending > 0 && state.heldUntil) return { line: `${count(pending)} waiting · indexing from ${state.heldUntil}` };
  // Code is read once the other folders have nothing waiting (the helper's order).
  if (pending > 0 && state.pending > 0) return { line: `${count(pending)} waiting · read after your other files` };
  if (pending > 0 && files > 0) {
    return { line: `Indexing code ${Math.floor((100 * indexed) / files)}% · ${indexed.toLocaleString()} of ${files.toLocaleString()}`,
             progress: indexed / files };
  }
  return { line: `${count(indexed)} indexed` };
}

function renderCode() {
  const code = info.code || { folders: [], editors: [], editor: "default" };
  const on = code.folders.length > 0;
  $("code-status").hidden = !on;
  const status = codeStatus();
  $("code-status-line").textContent = status.line;
  $("code-bar").hidden = status.progress == null;
  $("code-fill").style.width = `${Math.round(100 * (status.progress || 0))}%`;
  $("code-size").textContent = bytes(info.storage?.codeBytes || 0);

  const rows = $("code-rows");
  rows.replaceChildren();
  if (!on) rows.append(element("div", "f-card empty", "No code folders yet. Add the folders that hold your projects."));
  for (const folder of code.folders) {
    const summary = (codeSummaries || []).find((item) => same(item.path, folder)) || null;
    rows.append(folderRow(folder, summary, true));
  }
  $("add-code").lastElementChild.textContent = on ? "Add Folders…" : "Choose Code Folders…";

  const select = $("code-editor");
  const options = [...(code.editors || []), { id: "default", name: "The file's default app" }];
  select.replaceChildren(...options.map((editor) => {
    const option = element("option", "", editor.name);
    option.value = editor.id;
    return option;
  }));
  select.value = code.editor || "default";
  $("editor-note").textContent = "A result opens there at the line that matched. Space shows the whole file in DigUp's "
    + "preview.";
  $("code-off").hidden = !on;
}

$("add-code").onclick = () => addFolders(true);
$("code-editor").addEventListener("change", async () => {
  try {
    await invoke("set_code_editor", { editor: $("code-editor").value });
    info.code.editor = $("code-editor").value;
  } catch (error) {
    $("code-editor").value = info.code.editor || "default";
    fail(error);
  }
});
$("code-off").onclick = async () => {
  const size = info.storage?.codeBytes || 0;
  const ok = await confirmDialog({
    title: "Turn off code search?",
    text: `The code index (${bytes(size)}) is deleted. Turning it on again reads the code again.`,
    action: "Turn Off",
  });
  if (!ok) return;
  try {
    await invoke("turn_off_code");
  } catch (error) {
    fail(error);
  }
  await refresh();
};

// MARK: Storage

/// The model's download as the Mac's ModelDownload.progressText says it: "42% · about 1 min left".
function modelProgress(model = {}) {
  switch (model.state) {
    case "ready": return "Ready";
    case "downloading": {
      if (model.problem) return "Waiting for the network…";
      const percent = `${Math.floor(100 * fraction(model))}%`;
      const left = model.secondsLeft;
      if (left == null) return percent;
      return `${percent} · ${left < 50 ? "less than a minute left" : `about ${roughDuration(left)} left`}`;
    }
    case "checking": return "Checking the download…";
    case "waiting": return "Waiting for the network…";
    case "failed": return sentence(model.message || "The download stopped");
    case "needed": return "Not downloaded yet";
    default: return "";
  }
}

function modelActive(model = {}) {
  return ["downloading", "checking", "waiting"].includes(model.state);
}

function fraction(model) {
  return model.total > 0 ? Math.max(0, Math.min(1, (model.bytes || 0) / model.total)) : 0;
}

function renderStorage() {
  const storage = info.storage || {}, model = (info.state || {}).model || {};
  const ready = model.state === "ready";
  $("model-status").textContent = ready ? "Downloaded" : modelProgress(model);
  // Needed or stopped: download it again, or use files downloaded some other way.
  const recover = model.state === "failed" || model.state === "needed";
  $("model-download").hidden = !recover;
  $("model-files").hidden = !recover;
  $("model-footer").hidden = ready;
  pathButton($("model-path"), storage.models);
  $("index-size").textContent = bytes(storage.indexBytes || 0);
  $("code-index-fact").hidden = !(info.code?.folders || []).length;
  $("code-index-size").textContent = bytes(storage.codeBytes || 0);
  pathButton($("index-path"), storage.index);
  $("version").textContent = `DigUp ${info.version || ""} · EmbeddingGemma 2 by Google (Apache 2.0), run by llama.cpp (MIT).`;
  $("licenses").hidden = !info.licenses;
}

$("model-download").onclick = () => {
  hideProblem();
  invoke("retry_download").catch(fail);
};
$("model-files").onclick = async () => {
  hideProblem();
  try {
    const result = await invoke("use_model_files");
    // Cancelled: nothing to say. Files that aren't the model's: why.
    if (result && !result.ok && result.message) fail(result.message);
  } catch (error) {
    fail(error);
  }
};
$("copy-links").onclick = async () => {
  hideProblem();
  try {
    const links = (await invoke("model_links")) || [];
    await invoke("copy_text", { text: links.join("\n") });
  } catch (error) {
    fail(error);
  }
};

/// A folder's path, its start giving way first; a click shows it in the file manager.
function pathButton(button, path) {
  button.replaceChildren();
  button.hidden = !path;
  if (!path) return;
  const outer = document.createElement("bdi");
  const inner = element("span", "", native(path));
  outer.append(inner);
  button.append(outer, iconElement("link"));
  button.title = isWindows ? "Show in File Explorer" : "Show in Files";
  button.onclick = () => invoke("reveal", { path }).catch(fail);
}

// MARK: Dialogs (ContentDialog): one at a time, Esc cancels, Tab stays inside

let openDialog = null;   // { smoke, cancel, accept, restore }

function showDialog(smoke, { focus, cancel, accept }) {
  openDialog = { smoke, cancel, accept, restore: document.activeElement };
  smoke.hidden = false;
  (focus || smoke.querySelector("button"))?.focus();
}

function hideDialog() {
  if (!openDialog) return;
  const { smoke, restore } = openDialog;
  openDialog = null;
  smoke.hidden = true;
  if (restore && document.contains(restore)) restore.focus();
}

document.addEventListener("keydown", (event) => {
  if (!openDialog) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    openDialog.cancel();
  } else if (event.key === "Enter" && openDialog.accept && !event.target.closest?.("button, input[type=checkbox]")) {
    event.preventDefault();
    openDialog.accept();
  } else if (event.key === "Tab") {
    const focusable = [...openDialog.smoke.querySelectorAll("button, input, select")]
      .filter((node) => !node.disabled && node.offsetParent !== null);
    if (!focusable.length) return;
    const index = focusable.indexOf(document.activeElement);
    const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length;
    event.preventDefault();
    focusable[next].focus();
  }
}, true);

/// A confirmation (the Mac's confirmationDialog): `action`, in red, or Cancel, which has the focus. Resolves to
/// whether `action` was chosen.
function confirmDialog({ title, text, action }) {
  return new Promise((resolve) => {
    $("confirm-title").textContent = title;
    $("confirm-text").textContent = text;
    $("confirm-go").textContent = action;
    const finish = (ok) => {
      hideDialog();
      resolve(ok);
    };
    $("confirm-go").onclick = () => finish(true);
    $("confirm-cancel").onclick = () => finish(false);
    showDialog($("confirm"), { focus: $("confirm-cancel"), cancel: () => finish(false) });
  });
}

// MARK: Add Folders (AddFolders.swift and FolderChoices.swift): the usual folders not searched yet and any other
// folder chosen, each with what's in it, how long its first pass takes and its subfolders; nothing changes until Add.
// With nothing left to suggest it starts from the folder picker. With `code`, Code's: folders for code search, with
// how long reading them takes and how much room their index needs.

const SHORT_LIST = 8;   // subfolders shown before "Show N more"
let sheet = null;
let beginning = false;

/// The engine's FolderSelection: the folders chosen, minus the folders skipped inside them.
function makeSelection(chosen, skipped) {
  return {
    chosen: [...chosen],
    skipped: [...skipped],
    isSearched(path) {
      return this.chosen.some((folder) => (same(path, folder) || inside(path, folder))
        && !this.skipped.some((skip) => inside(skip, folder) && (same(path, skip) || inside(path, skip))));
    },
    /// The chosen folder that searches `path`.
    searchedAs(path) {
      return this.chosen.find((folder) => same(path, folder) || inside(path, folder)) || null;
    },
    /// A folder's checkbox: mixed when some of its subfolders are skipped (it's searched) or chosen (it isn't).
    mark(folder) {
      if (this.isSearched(folder)) {
        return this.skipped.some((skip) => same(parentOf(skip), folder) && !this.isSearched(skip)) ? "mixed" : "on";
      }
      return this.chosen.some((chosen) => same(parentOf(chosen), folder)) ? "mixed" : "off";
    },
    /// A folder and its subfolders: all of it, or none of it.
    setFolder(folder, on) {
      this.skipped = this.skipped.filter((skip) => !same(parentOf(skip), folder));
      this.chosen = this.chosen.filter((chosen) => !same(parentOf(chosen), folder));
      this.setSubfolder(folder, on);
    },
    setSubfolder(folder, on) {
      if (on) {
        this.skipped = this.skipped.filter((skip) => !same(skip, folder));
        if (!this.isSearched(folder)) this.chosen.push(folder);
      } else {
        this.chosen = this.chosen.filter((chosen) => !same(chosen, folder));
        if (this.isSearched(folder)) this.skipped.push(folder);
      }
    },
    /// What the indexer gets: the chosen folders, without those another one already searches whole.
    folders() {
      const all = unique(this.chosen);
      return all.filter((folder) => !all.some((other) => !same(other, folder) && inside(folder, other)
        && !this.skipped.some((skip) => inside(skip, other) && (same(folder, skip) || inside(folder, skip)))));
    },
    /// The skips that leave something out (inside a folder that's searched).
    skips() {
      const folders = this.folders();
      return unique(this.skipped).filter((skip) => folders.some((folder) => inside(skip, folder)));
    },
  };
}

async function addFolders(code) {
  if (sheet || beginning) return;
  beginning = true;
  hideProblem();
  try {
    const chosen = ((code ? info.code?.folders : info.folders) || []).map(canon);
    const skipped = ((code ? info.code?.skipped : info.skipped) || []).map(canon);
    const next = { code, rows: [], estimates: new Map(), runs: new Map(), run: 0, estimating: 0, open: new Set(),
                   showAll: new Set(), note: null, problem: null, selection: makeSelection(chosen, skipped) };
    next.initial = signature(next.selection);
    let offered = [];
    try {
      offered = (await invoke(code ? "code_setup_info" : "setup_info"))?.offered || [];
    } catch {
      offered = [];
    }
    next.rows = unique(offered.map(canon)).filter((path) => !next.selection.isSearched(path));
    // A folder with some of its subfolders chosen or skipped starts open, so it shows which.
    for (const row of next.rows) {
      if ([...next.selection.chosen, ...next.selection.skipped].some((path) => same(parentOf(path), row))) next.open.add(key(row));
    }
    if (!next.rows.length) {
      const picked = (await invoke("pick_folders")) || [];
      if (!picked.length) return;
      sheet = next;
      addPicked(picked, false);
    }
    sheet = next;
    $("add-title").textContent = code ? "Search your code" : "Add folders to search";
    $("add-subtitle").textContent = code
      ? "Pick the folders that hold your projects; open one to pick among its repos. DigUp reads each once, then what "
        + "changes. Code is searched on its own: type code: in the search panel."
      : "DigUp reads a new folder once, then keeps up with what changes in it. Open a folder to pick some of its "
        + "subfolders.";
    $("code-folder-note").hidden = !code;
    $("choices").scrollTop = 0;
    renderSheet();
    // The dialog itself has the focus, so that Enter is Add (the Mac's default button) and Tab goes to its folders.
    showDialog($("add-sheet"), { focus: $("add-sheet").querySelector(".f-dialog"), cancel: closeSheet,
                                 accept: () => $("add-go").click() });
    estimateRows(sheet.rows.filter((row) => !sheet.runs.has(key(row))));
  } finally {
    beginning = false;
  }
}

function closeSheet() {
  sheet = null;
  hideDialog();
}

/// The folders and skips the selection hands over, to tell whether Add changes anything.
function signature(selection) {
  const keys = (paths) => paths.map(key).sort().join("\n");
  return `${keys(selection.folders())}\n--\n${keys(selection.skips())}`;
}

function changesSomething() {
  return Boolean(sheet) && signature(sheet.selection) !== sheet.initial;
}

/// Choose Another Folder…: a folder listed (or a subfolder of one, which opens) gets checked; any other is listed,
/// checked, unless it's searched already (a note says as part of what).
function addPicked(picked, render = true) {
  const selection = sheet.selection;
  sheet.note = null;
  const fresh = [];
  for (const raw of picked) {
    const path = canon(raw);
    const row = sheet.rows.find((other) => same(other, path));
    const parent = sheet.rows.find((other) => same(other, parentOf(path)));
    if (row) {
      selection.setFolder(row, true);
    } else if (parent) {
      selection.setSubfolder(path, true);
      sheet.open.add(key(parent));
    } else if (selection.isSearched(path)) {
      const by = selection.searchedAs(path);
      sheet.note = `“${nameOf(path)}” is searched already` + (!by || same(by, path) ? "." : `, as part of “${nameOf(by)}”.`);
    } else {
      sheet.rows.push(path);
      selection.setFolder(path, true);
      fresh.push(path);
    }
  }
  // Before the dialog is up, they're estimated with the rest once it is.
  if (render) {
    renderSheet();
    estimateRows(fresh);
  }
}

$("choose-another").onclick = async () => {
  const current = sheet;
  const picked = (await invoke("pick_folders")) || [];
  if (picked.length && sheet === current && sheet) addPicked(picked);
};

/// The helper's look at these folders, one answer each with its subfolders. An answer from an earlier run of a row is
/// dropped.
async function estimateRows(paths) {
  const current = sheet;
  if (!current || !paths.length) return;
  const run = ++current.run;
  for (const path of paths) {
    current.runs.set(key(path), run);
    current.estimates.delete(key(path));
  }
  current.estimating += 1;
  renderSheet();
  let answers = [];
  try {
    answers = (await invoke("estimate", { folders: paths.map(native), code: current.code })) || [];
  } catch {
    answers = [];
  }
  current.estimating -= 1;
  if (sheet !== current) return;
  for (const answer of answers) {
    if (current.runs.get(key(answer.folder)) === run) current.estimates.set(key(answer.folder), answer);
  }
  for (const path of paths) {
    if (current.runs.get(key(path)) === run && !current.estimates.has(key(path))) {
      current.estimates.set(key(path), { folder: path, failed: true, files: {}, seconds: 0 });
    }
  }
  renderSheet();
}

/// What a row adds as checked now: all of it but its unchecked subfolders, or just its checked ones.
function partOf(row) {
  const answer = sheet.estimates.get(key(row));
  if (!answer) return null;
  const selection = sheet.selection;
  const part = { seconds: 0, later: 0, bytes: 0, files: {} };
  const add = (estimate, sign) => {
    part.seconds += sign * (estimate.seconds || 0);
    part.later += sign * (estimate.later_seconds || 0);
    part.bytes += sign * (estimate.bytes || 0);
    for (const [kind, count] of Object.entries(estimate.files || {})) part.files[kind] = (part.files[kind] || 0) + sign * count;
  };
  const subfolders = answer.subfolders || [];
  if (!selection.isSearched(row)) {
    for (const subfolder of subfolders) if (selection.isSearched(subfolder.folder)) add(subfolder, 1);
    return part;
  }
  // Inside another listed folder that searches it: counted there.
  if (sheet.rows.some((other) => !same(other, row) && inside(row, other) && selection.isSearched(other))) return part;
  add(answer, 1);
  for (const subfolder of subfolders) if (!selection.isSearched(subfolder.folder)) add(subfolder, -1);
  part.seconds = Math.max(0, part.seconds);
  part.later = Math.max(0, part.later);
  part.bytes = Math.max(0, part.bytes);
  for (const kind of Object.keys(part.files)) if (part.files[kind] <= 0) delete part.files[kind];
  return part;
}

function wholePart(answer) {
  return answer ? { seconds: answer.seconds || 0, later: answer.later_seconds || 0, bytes: answer.bytes || 0,
                    files: answer.files || {} } : null;
}

/// "Adds about 4 min of indexing, and 12 min more for long files", once every estimate is in.
function sheetSummary() {
  if (!changesSomething()) return "Check the folders to add";
  if (!sheet.rows.every((row) => sheet.estimates.has(key(row)))) return "Looking at the folders…";
  const total = { seconds: 0, later: 0, bytes: 0 };
  for (const row of sheet.rows) {
    const part = partOf(row);
    if (!part) continue;
    total.seconds += part.seconds;
    total.later += part.later;
    total.bytes += part.bytes;
  }
  const time = total.seconds < 1 ? "under a second" : `about ${roughDuration(total.seconds)}`;
  if (sheet.code) return `Adds ${time} of indexing and ${roughBytes(total.bytes)}`;
  return `Adds ${time} of indexing` + (total.later >= 30 ? `, and ${roughDuration(total.later)} more for long files` : "");
}

function renderSheet() {
  if (!sheet) return;
  const list = $("choice-list");
  const scroll = $("choices").scrollTop;
  list.replaceChildren(...sheet.rows.map(choiceBox));
  $("choices").scrollTop = scroll;
  $("choice-note").hidden = !sheet.note;
  $("choice-note-text").textContent = sheet.note || "";
  const summary = $("add-summary");
  summary.textContent = sheet.problem || sheetSummary();
  summary.classList.toggle("problem-text", Boolean(sheet.problem));
  $("add-go").disabled = !changesSomething();
}

/// A folder: disclosure, checkbox, icon, what's in it and how long its first pass takes; open, its subfolders.
function choiceBox(row) {
  const selection = sheet.selection;
  const answer = sheet.estimates.get(key(row));
  const mark = selection.mark(row);
  const subfolders = answer?.subfolders || [];
  const isOpen = sheet.open.has(key(row)) && subfolders.length > 0;
  const box = element("div", "choice" + (mark === "off" ? " off" : ""));
  const header = element("div", "choice-head");
  const disclosure = element("button", "disclosure" + (isOpen ? " open" : ""));
  disclosure.type = "button";
  disclosure.append(iconElement("chevron"));
  disclosure.disabled = !subfolders.length;
  disclosure.title = isOpen ? "Hide its subfolders" : "Choose among its subfolders";
  disclosure.setAttribute("aria-label", (isOpen ? "Hide the subfolders of " : "Show the subfolders of ") + nameOf(row));
  disclosure.setAttribute("aria-expanded", String(isOpen));
  disclosure.onclick = () => {
    if (sheet.open.has(key(row))) sheet.open.delete(key(row)); else sheet.open.add(key(row));
    renderSheet();
  };
  const toggle = () => {
    sheet.note = null;
    sheet.problem = null;
    selection.setFolder(row, mark !== "on");
    renderSheet();
  };
  const check = checkbox(mark, nameOf(row), toggle);
  const text = element("div", "choice-text");
  text.append(element("div", "choice-name", nameOf(row)));
  // Off, a folder shows all it holds (what checking it would take); else what's searched of it.
  const part = mark === "off" ? wholePart(answer) : partOf(row);
  if (answer?.failed) {
    text.append(element("div", "path", "Couldn't look inside it; it can still be searched."));
  } else if (answer && answer.readable === false) {
    text.append(element("div", "warn", isWindows ? "Windows isn't letting DigUp read it." : "DigUp isn't allowed to read it."));
  } else if (part && Object.values(part.files).some((count) => count > 0)) {
    text.append(kindCounts(part.files));
  } else {
    text.append(element("div", "path", !answer ? native(row)
      : !Object.keys(answer.files || {}).length ? (sheet.code ? "No code here" : "Nothing to search here yet")
      : "Nothing to search in the subfolders checked"));
  }
  header.append(disclosure, check, folderIcon(row, 30), text);
  if (answer) header.append(timeOf(part, mark === "off", Object.keys(answer.files || {}).length === 0));
  else header.append(element("div", "f-ring"));
  header.onclick = (event) => {
    if (event.target.closest("button, input")) return;
    toggle();
  };
  box.append(header);
  if (isOpen) {
    const list = element("div", "subchoices");
    const all = sheet.showAll.has(key(row));
    for (const subfolder of all ? subfolders : subfolders.slice(0, SHORT_LIST)) list.append(subchoice(subfolder));
    if (!all && subfolders.length > SHORT_LIST) {
      const more = element("button", "more", `Show ${subfolders.length - SHORT_LIST} more`);
      more.type = "button";
      more.onclick = () => { sheet.showAll.add(key(row)); renderSheet(); };
      list.append(more);
    }
    box.append(list);
  }
  return box;
}

function subchoice(subfolder) {
  const on = sheet.selection.isSearched(subfolder.folder);
  const item = element("div", "subchoice" + (on ? "" : " off"));
  const toggle = () => {
    sheet.note = null;
    sheet.problem = null;
    sheet.selection.setSubfolder(canon(subfolder.folder), !on);
    renderSheet();
  };
  const time = approximately(subfolder.seconds || 0) + (sheet.code ? ` · ${roughBytes(subfolder.bytes || 0)}`
    : (subfolder.later_seconds || 0) >= 30 ? ` + ${roughDuration(subfolder.later_seconds)} later` : "");
  const times = element("div", "time", time);
  times.title = sheet.code ? CODE_HELP : LATER_HELP;
  item.append(checkbox(on ? "on" : "off", nameOf(subfolder.folder), toggle), folderIcon(subfolder.folder, 18),
              element("span", "choice-name", nameOf(subfolder.folder)), kindCounts(subfolder.files || {}), times);
  item.onclick = (event) => { if (!event.target.closest("input")) toggle(); };
  return item;
}

const LATER_HELP = "The first pass takes this long. Long PDFs and documents get their first pages in it, and the rest "
  + "afterwards, once everything else is in.";
const CODE_HELP = "How long reading this code takes, once, and about how much room its index needs. After that, only "
  + "what changes is read again.";

/// "≈ 4 min", with "+ 2 min later" for the rest of long files (code: the room its index takes).
function timeOf(part, quiet, empty) {
  const time = element("div", "time" + (quiet ? " quiet" : ""), empty ? "—" : approximately(part?.seconds || 0));
  if (!empty && sheet.code && (part?.bytes || 0) > 0) time.append(element("small", "", roughBytes(part.bytes)));
  else if (!empty && !sheet.code && (part?.later || 0) >= 30) time.append(element("small", "", `+ ${roughDuration(part.later)} later`));
  time.title = sheet.code ? CODE_HELP : LATER_HELP;
  return time;
}

function checkbox(mark, label, action) {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "f-check";
  box.checked = mark === "on";
  box.indeterminate = mark === "mixed";
  box.setAttribute("aria-label", label);
  box.onclick = (event) => {
    event.preventDefault();   // the selection decides what it shows
    action();
  };
  return box;
}

$("add-cancel").onclick = closeSheet;
$("add-go").onclick = async () => {
  if (!changesSomething()) return;
  const current = sheet;
  const args = { folders: current.selection.folders().map(native), skipped: current.selection.skips().map(native) };
  $("add-go").disabled = true;
  try {
    await invoke(current.code ? "set_code_folders" : "apply_setup_folders", args);
  } catch (error) {
    if (sheet !== current) return;
    current.problem = String(error);
    renderSheet();
    return;
  }
  if (sheet === current) closeSheet();
  await refresh();
};

// MARK: Words

const KINDS = [
  ["screenshot", "screenshot", "screenshot", "screenshots"], ["image", "image", "image", "images"],
  ["pdf", "pdf", "PDF", "PDFs"], ["doc", "doc", "document", "documents"], ["audio", "audio", "audio file", "audio files"],
  ["video", "video", "video", "videos"], ["code", "codeFile", "code file", "code files"],
];

/// What's in a folder by kind, an icon and a count each, "136 screenshots, 104 images, 25 PDFs" when hovered.
function kindCounts(counts) {
  const row = element("div", "kinds");
  const words = [];
  for (const [kind, name, one, many] of KINDS) {
    const count = counts[kind] || 0;
    if (count <= 0) continue;
    const item = element("span", "kind");
    item.append(iconElement(name), document.createTextNode(count.toLocaleString()));
    row.append(item);
    words.push(`${count.toLocaleString()} ${count === 1 ? one : many}`);
  }
  row.title = words.join(", ");
  row.setAttribute("aria-label", row.title);
  return row;
}

/// Sizes the way file managers count them: "62 KB", "2.1 MB".
function bytes(count) {
  if (count < 1000) return `${count} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = count / 1000, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/// "360 KB", "12 MB": an index's size, roughly.
function roughBytes(count) {
  if (count < 1e6) return `${Math.max(1, Math.round(count / 1e3))} KB`;
  if (count < 1e9) return `${Math.round(count / 1e6)} MB`;
  return `${(count / 1e9).toFixed(1)} GB`;
}

/// "45 s", "4 min", "1.5 h": the precision an estimate deserves (the Mac app's roughDuration).
function roughDuration(seconds) {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function approximately(seconds) {
  return seconds < 0.5 ? "< 1 s" : `≈ ${roughDuration(seconds)}`;
}

function sentence(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function clock(minute) {
  return `${String(Math.trunc(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function minutes(text, fallback) {
  const match = /^(\d{1,2}):(\d{2})/.exec(text || "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
}

// MARK: Paths
// The helper reports folders with forward slashes; on Windows the shell gives them with backslashes, and case doesn't
// matter. They're compared in one spelling and shown and handed back as the system writes them.

function canon(path) { return (path || "").replaceAll("\\", "/").replace(/(.)\/+$/, "$1"); }
function key(path) { return isWindows ? canon(path).toLowerCase() : canon(path); }
function same(a, b) { return key(a) === key(b); }
function inside(path, folder) { return key(path).startsWith(key(folder) + "/"); }
function parentOf(path) { const c = canon(path); return c.slice(0, c.lastIndexOf("/")) || c; }
function native(path) { return isWindows ? canon(path).replaceAll("/", "\\") : canon(path); }
function nameOf(path) { return canon(path).split("/").filter(Boolean).pop() || path; }
function unique(paths) { return paths.filter((path, index) => paths.findIndex((other) => same(other, path)) === index); }

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fail(error) {
  $("problem-text").textContent = String(error);
  $("problem").hidden = false;
}

function hideProblem() {
  $("problem").hidden = true;
}

$("problem-close").onclick = hideProblem;

// MARK: Start

async function refresh() {
  info = (await invoke("settings_info")) || {};
  loaded = true;
  renderGeneral();
  renderStatus();
  renderFolders();
  renderFields();
  renderStorage();
  renderCode();
  if (tab === "folders") loadSummaries();
  if (tab === "code") loadCodeSummaries();
}

// Back from a folder picker (or anything else that changed the settings): shown as they are now.
window.addEventListener("focus", () => { if (!recording) refresh().catch(() => {}); });

// Indexing as it goes, and what's indexed under each folder at most every two seconds.
let summariesTimer = null;
tauri.event.listen("state", ({ payload }) => {
  const before = info.state || {};
  info.state = payload;
  renderStatus();
  renderStorage();
  renderUpdates();
  renderCode();
  // The code index's progress isn't in the state: its folders are asked again while the tab is up.
  const counts = payload.searchable !== before.searchable || payload.pending !== before.pending;
  const load = tab === "folders" && counts ? loadSummaries : tab === "code" ? loadCodeSummaries : null;
  if (load && !summariesTimer) {
    summariesTimer = setTimeout(() => { summariesTimer = null; load(); }, 2000);
  }
});

async function start() {
  // open_settings { tab } opens the window at settings.html?tab=…
  showTab(new URLSearchParams(location.search).get("tab") || "general");
  await refresh();
  // Debug runs (--debug-settings): the page is up.
  if (info.debug) {
    invoke("debug_report", { report: { settings: true, hotkey: info.hotkey, openAtLogin: info.openAtLogin,
                                       canOpenAtLogin: info.canOpenAtLogin, folders: info.folders } }).catch(() => {});
  }
}

start();
