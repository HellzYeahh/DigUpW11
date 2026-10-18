// Windows 11's look for every page of the shell: asks the shell whether the window has a backdrop (Mica or Acrylic,
// Windows 11 only) and for the person's accent color, and puts both on the root element for fluent.css. Loaded first,
// before a page's own script, so nothing draws in the wrong colors.
"use strict";

(() => {
  const root = document.documentElement;
  const platform = /Win/.test(navigator.platform) ? "windows" : /Mac/.test(navigator.platform) ? "mac" : "linux";
  root.dataset.platform = platform;
  const tauri = window.__TAURI__;
  if (!tauri) return;
  const apply = (look) => {
    if (look.backdrop) root.dataset.backdrop = "";
    else delete root.dataset.backdrop;
    // Light3, Light2, Light1, the accent, Dark1, Dark2, Dark3, as WinUI names them. A light page uses the darker
    // shades for fills and text, a dark page the lighter ones.
    const shades = look.accent;
    if (shades && shades.length === 7) {
      const names = ["light3", "light2", "light1", "base", "dark1", "dark2", "dark3"];
      names.forEach((name, index) => root.style.setProperty(`--accent-${name}`, shades[index]));
      root.dataset.accent = "";
    }
  };
  tauri.core.invoke("system_look").then(apply).catch(() => {});
  // The person changed the accent or between light and dark while the page is open.
  tauri.event.listen("system-look", (event) => apply(event.payload));
})();
