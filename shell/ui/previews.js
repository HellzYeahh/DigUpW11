// What the panel and the window both draw for a result (the Mac app's Previews.swift and Components.swift): the
// preview's picture (the frame or page that matched with its moment on it, a recording's moment on its timeline, the
// passage on a page, the lines of code), the facts and why it matched, the Open and Show buttons, the big preview, the
// shell's icons for files, and a result's clicks, drag and right-click menu. results.js has what a result says.
"use strict";

let playing = null;   // the selected recording's audio, while it plays

/// The shell's picture of a file (contract `file_icon`: Windows' thumbnail or icon), or null where it has none (Linux).
const icons = new Map();
function fileIcon(path, size) {
  const pixels = Math.round(size * (window.devicePixelRatio || 1));
  const key = `${path}|${pixels}`;
  if (!icons.has(key)) icons.set(key, invoke("file_icon", { path, size: pixels }).then((url) => url || null, () => null));
  return icons.get(key);
}

/// A kind's own icon in `box` at once, swapped for the shell's icon of the file once that comes.
function iconOf(hit, size, className = "") {
  const box = element("div", className);
  box.innerHTML = ICONS[hit.kind] || ICONS.doc;
  fileIcon(hit.path, size).then((url) => {
    if (!url) return;
    const image = element("img", "file-icon");
    image.alt = "";
    image.src = url;
    box.replaceChildren(image);
    box.classList.add("shell-icon");
  });
  return box;
}

/// "p. 3", "0:06": the page or moment that matched, on a picture or beside a name.
function placeBadge(text, onImage) {
  return element("span", "place" + (onImage ? " on-image" : ""), text);
}

/// A name too long for its line loses its middle, as the Mac's do: "Screenshot 2026-10-0…at 14.22.png". Its end (the
/// extension and a few letters) never shrinks; the rest gives way with an ellipsis.
function nameLine(name, className = "name") {
  const line = element("span", className + " middle");
  line.title = name;
  const dot = name.lastIndexOf(".");
  const keep = Math.min(name.length, (dot > 0 && name.length - dot <= 8 ? name.length - dot : 0) + 7);
  if (name.length <= 16) {
    line.append(element("span", "start", "‎" + name));
    return line;
  }
  line.append(element("span", "start", "‎" + name.slice(0, name.length - keep)),
              element("span", "end", "‎" + name.slice(name.length - keep)));
  return line;
}

/// A folder too long for its line loses its start: "…\Pictures\Screenshots".
function folderLine(text, tag = "div") {
  const line = element(tag, "folder");
  const inner = document.createElement("bdi");
  inner.textContent = text;
  line.append(inner);
  line.title = text;
  return line;
}

/// The preview's picture, `width` × `height` at most: the photo or screenshot, the frame at the moment (it plays from
/// there), the page, the moment in a recording, the passage that matched, or the lines of code. `small` is the size
/// of a picture already drawn for the result (a row's or a cell's), shown until the bigger one comes.
function previewPicture(hit, { query, open, width, height, small }) {
  const box = element("div", "preview-picture");
  box.style.height = `${height}px`;
  if (hit.kind === "audio") {
    box.append(audioMoment(hit));
    box.style.height = `${Math.min(height, 150)}px`;
    return box;
  }
  if (hit.kind === "code") {
    box.append(codeLines(hit, query, open));
    if (span(hit)) box.append(placeBadge(span(hit), true));
    return box;
  }
  if (hit.segment === "chunk") {
    box.append(passage(hit, query, open));
    const parts = Number(hit.info?.chunks || 0);
    if (hit.loc != null && parts > 1) box.append(placeBadge(`Part ${Math.trunc(hit.loc)} of ${parts}`, true));
    return box;
  }
  const what = renderOf(hit);
  if (!what) {
    const placeholder = element("div", "placeholder");
    placeholder.append(iconOf(hit, 64, "placeholder-icon"));
    placeholder.ondblclick = () => open(hit);
    box.append(placeholder);
    return box;
  }
  const frame = element("div", "frame");
  frame.style.maxWidth = `${width}px`;
  const image = element("img");
  image.alt = "";
  image.style.maxWidth = `${width}px`;
  image.style.maxHeight = `${height}px`;
  frame.append(image);
  // The smaller picture first (already drawn), then one the size of the box: never the file itself, which can be a
  // photo of tens of megapixels.
  const scale = window.devicePixelRatio || 1;
  if (small) {
    renders.get(`${hit.path}|${what[0]}|${what[1]}|${Math.round(small * scale)}`)
      ?.then((file) => { if (!image.dataset.big) image.src = fileURL(file); }).catch(() => {});
  }
  // A page has the words marked, as the Mac's preview does: the ones keyword search found and the query's.
  const words = what[0] === "pdf" ? [...new Set([...foundWords(hit.excerpt), ...queryWords(query || "")])] : [];
  rendered(hit.path, what[0], what[1], Math.round(Math.max(width, height) * scale), words)
    .then((file) => { image.dataset.big = "1"; image.src = fileURL(file); })
    .catch(() => {});
  image.ondblclick = () => open(hit);
  const place = placeOf(hit);
  if (place) {
    const marks = element("div", "marks" + (hit.kind === "video" ? " dim" : ""));
    marks.append(placeBadge(place, true));
    const duration = Number(hit.info?.duration || 0);
    if (hit.kind === "video" && hit.loc != null && duration > 0) {
      marks.append(momentBar(hit.loc, hit.loc_end ?? hit.loc + 3, duration));
    }
    frame.append(marks);
  }
  if (hit.kind === "video") {
    // ▶ plays it here from the moment that matched.
    const play = element("button", "play");
    play.innerHTML = ICONS.play;
    play.title = `Play from ${clock(hit.loc ?? 0)}`;
    play.setAttribute("aria-label", play.title);
    play.onmousedown = (event) => event.preventDefault();
    play.onclick = () => {
      const video = element("video");
      video.src = `${fileURL(hit.path)}#t=${hit.loc ?? 0}`;
      video.controls = true;
      video.autoplay = true;
      box.replaceChildren(video);
    };
    frame.append(play);
  }
  box.append(frame);
  return box;
}

/// Where a moment sits in a recording: a track with the matched stretch lit (and where playback is).
function momentBar(start, end, duration, playhead) {
  const bar = element("div", "moment-bar");
  const from = Math.max(0, Math.min(1, start / duration)), to = Math.max(from, Math.min(1, end / duration));
  const lit = element("div", "lit");
  lit.style.left = `${from * 100}%`;
  lit.style.width = `${(to - from) * 100}%`;
  bar.append(lit);
  if (playhead != null) {
    const head = element("div", "head");
    head.style.left = `${Math.max(0, Math.min(1, playhead / duration)) * 100}%`;
    bar.append(head);
  }
  bar.title = `At ${clock(start)} of ${clock(duration)}`;
  return bar;
}

/// An audio result: the stretch that matched on the file's timeline, and ▶ to hear it from there.
function audioMoment(hit) {
  const box = element("div", "audio-moment");
  const start = hit.loc ?? 0, end = hit.loc_end ?? start + 30;
  const duration = Number(hit.info?.duration || 0);
  const controls = element("div", "controls");
  const wave = element("div", "wave");
  wave.innerHTML = ICONS.audio;
  const toggle = element("button", "toggle play-icon");
  toggle.innerHTML = ICONS.play;
  toggle.title = `Play from ${clock(start)}`;
  toggle.setAttribute("aria-label", toggle.title);
  toggle.onmousedown = (event) => event.preventDefault();
  controls.append(wave, toggle);
  const line = element("div", "span", `${clock(start)} – ${clock(end)}` + (duration ? ` of ${clock(duration)}` : ""));
  let bar = duration > 0 ? momentBar(start, end, duration) : null;
  box.append(controls, ...(bar ? [bar] : []), line);
  const showPlaying = () => {
    const on = playing != null && !playing.paused;
    toggle.innerHTML = on ? ICONS.pause : ICONS.play;
    toggle.classList.toggle("play-icon", !on);
  };
  toggle.onclick = () => {
    if (!playing) {
      const audio = new Audio(`${fileURL(hit.path)}#t=${start}`);
      audio.ontimeupdate = () => {
        line.textContent = `${clock(audio.currentTime)} – playing from ${clock(start)}`;
        if (bar) {
          const moved = momentBar(start, end, duration, audio.currentTime);
          bar.replaceWith(moved);
          bar = moved;
        }
      };
      audio.onplay = audio.onpause = showPlaying;
      audio.onended = () => {
        stopPlaying();
        showPlaying();
      };
      playing = audio;
    }
    if (playing.paused) playing.play().catch(() => {});
    else playing.pause();
  };
  return box;
}

function stopPlaying() {
  if (!playing) return;
  playing.pause();
  playing.removeAttribute("src");
  playing = null;
}

/// The part of a document that matched, on a page, the words marked: ~900 characters from just before the first.
function passage(hit, query, open) {
  const page = element("div", "passage");
  const found = foundWords(hit.excerpt);
  const show = (text) => {
    page.dir = isRightToLeft(text) ? "rtl" : "ltr";
    page.innerHTML = highlighted(passageAround(text, [...found, ...queryWords(query)]), query, found);
  };
  show((hit.excerpt ?? "").replace(/[«»]/g, ""));
  ask({ op: "text", segment: hit.segment_id, code: false })
    .then((reply) => { if (reply?.text) show(reply.text); })
    .catch(() => {});
  page.ondblclick = () => open(hit);
  return page;
}

/// The lines of code that matched, numbered as in the file: the query's words marked, the line it opens at lit, and
/// scrolled to it. A notebook's cells have no line numbers of their own, so theirs count from 1.
function codeLines(hit, query, open) {
  const box = element("div", "code-lines");
  const first = hit.segment === "lines" ? Math.max(1, Math.trunc(hit.loc ?? 1)) : 1;
  const focus = hit.segment === "lines" && hit.focus != null ? Math.trunc(hit.focus) - first : null;
  const found = foundWords(hit.excerpt);
  const show = (text) => {
    const lines = text.split(/\r?\n/).map((line) => line.replaceAll("\t", "    "));
    const width = String(first + Math.max(lines.length, 1)).length;
    box.replaceChildren();
    let firstMarked = null;
    lines.forEach((line, offset) => {
      const row = element("div", "line" + (offset === focus ? " focus" : ""));
      const number = element("span", "number", String(first + offset));
      number.style.width = `${width}ch`;
      const code = element("span");
      code.innerHTML = highlighted(line || " ", query, found);
      if (firstMarked == null && code.querySelector("mark")) firstMarked = offset;
      row.append(number, code);
      box.append(row);
    });
    const target = focus ?? firstMarked;
    // Scrolled within itself only: scrolling it into view would move the page around it too.
    if (target != null && target > 3) {
      requestAnimationFrame(() => {
        const line = box.children[target - 2];
        if (line) box.scrollTop += line.getBoundingClientRect().top - box.getBoundingClientRect().top - 10;
      });
    }
  };
  ask({ op: "text", segment: hit.segment_id, code: true })
    .then((reply) => show(reply?.text || (hit.excerpt ?? "").replace(/[«»]/g, "")))
    .catch(() => show((hit.excerpt ?? "").replace(/[«»]/g, "")));
  box.ondblclick = () => open(hit);
  return box;
}

/// Its name, its folder (a click shows it in the file manager) and its details.
function facts(hit, reveal) {
  const box = element("div", "facts");
  const title = element("div", "title", "‎" + nameOf(hit.path));
  title.title = nameOf(hit.path);
  const folder = folderLine(folderOf(hit), "button");
  folder.title = `Show in ${FILE_MANAGER}`;
  folder.onmousedown = (event) => event.preventDefault();
  folder.onclick = () => reveal(hit);
  box.append(title, folder, element("div", "details", details(hit)));
  return box;
}

/// "Matches the frame at 0:06" (the meaning's icon, in amber) or "Has your words" (the words' icon), and the words it
/// has, if any.
function why(hit) {
  const box = element("div", "why");
  const meaning = matchedMeaning(hit);
  const reason = element("div", "reason" + (meaning ? "" : " words"));
  reason.innerHTML = meaning ? ICONS.meaning : ICONS.words;
  reason.append(element("span", "", reasonOf(hit)));
  box.append(reason);
  // Code shows its lines above, the words marked there.
  if (hit.excerpt && hit.kind !== "code") {
    const excerpt = element("div", "excerpt");
    excerpt.dir = "auto";
    excerpt.innerHTML = marked(hit.excerpt);
    box.append(excerpt);
  }
  return box;
}

/// Open (the default button: "Open at 0:06", "Open in Zed") and Show in Explorer.
function previewActions(hit, open, reveal) {
  const box = element("div", "actions");
  const openButton = element("button", "f-button accent open", openTitle(hit));
  openButton.onmousedown = (event) => event.preventDefault();
  openButton.onclick = () => open(hit);
  const revealButton = element("button", "f-button reveal", `Show in ${FILE_MANAGER}`);
  revealButton.onmousedown = (event) => event.preventDefault();
  revealButton.onclick = () => reveal(hit);
  box.append(openButton, revealButton);
  return box;
}

/// The big preview's sheet: the name and place, Open and ×, and the result as big as the window allows: the picture
/// or the page, the video or the recording from the moment, the passage or the lines of code.
function bigSheet(hit, { query, open, close }) {
  const sheet = element("div", "sheet");
  const head = element("div", "head");
  const title = element("div", "title");
  title.append(element("span", "name", nameOf(hit.path)));
  const place = placeOf(hit);
  if (place) title.append(element("span", "place", place));
  const opening = element("button", "f-button accent", openTitle(hit));
  opening.onmousedown = (event) => event.preventDefault();
  opening.onclick = () => {
    close();
    open(hit);
  };
  const shut = element("button", "f-button subtle close");
  shut.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4 4 L12 12 M12 4 L4 12"/></svg>';
  shut.title = "Close (Space)";
  shut.setAttribute("aria-label", "Close");
  shut.onmousedown = (event) => event.preventDefault();
  shut.onclick = close;
  head.append(title, opening, shut);
  sheet.append(head, bigView(hit, query, open, close));
  return sheet;
}

function bigView(hit, query, open, close) {
  const view = element("div", "view");
  if (hit.kind === "code" || hit.segment === "chunk") {
    view.classList.add("text");
    view.append(hit.kind === "code" ? codeLines(hit, query, open) : passage(hit, query, open));
    return view;
  }
  if (hit.kind === "video" || hit.kind === "audio") {
    const media = element(hit.kind === "video" ? "video" : "audio");
    media.src = `${fileURL(hit.path)}#t=${hit.loc ?? 0}`;
    media.controls = true;
    media.autoplay = true;
    view.append(media);
    return view;
  }
  const what = renderOf(hit);
  if (!what) {
    const placeholder = element("div", "placeholder");
    placeholder.append(iconOf(hit, 96, "placeholder-icon"));
    view.append(placeholder);
    return view;
  }
  const image = element("img");
  image.alt = "";
  if (what[0] === "image" && SHOWN_AS_IS.has(extensionOf(hit.path))) {
    // One picture, as big as the screen allows: the file itself.
    image.src = fileURL(hit.path);
  } else {
    const pixels = Math.round(Math.max(innerWidth, innerHeight) * (window.devicePixelRatio || 1));
    rendered(hit.path, what[0], what[1], pixels).then((file) => { image.src = fileURL(file); }).catch(() => {});
  }
  image.ondblclick = () => {
    close();
    open(hit);
  };
  view.append(image);
  return view;
}

// MARK: Menus (Fluent's MenuFlyout)

let $menu = null;

/// A menu at (x, y): [title, action, shortcut?, enabled?] items, null for a line between them.
function showMenu(x, y, items) {
  if (!$menu) {
    $menu = element("div", "f-menu result-menu");
    $menu.setAttribute("role", "menu");
    $menu.hidden = true;
    document.body.append($menu);
    document.addEventListener("mousedown", (event) => {
      if (!$menu.hidden && !$menu.contains(event.target)) hideMenu();
    });
    window.addEventListener("blur", hideMenu);
  }
  $menu.replaceChildren();
  for (const item of items) {
    if (!item) {
      $menu.append(element("div", "f-menu-separator"));
      continue;
    }
    const [title, action, shortcut, enabled = true] = item;
    const button = element("button", "f-menu-item");
    button.append(element("span", "", title));
    button.setAttribute("role", "menuitem");
    button.disabled = !enabled;
    if (shortcut) button.append(element("span", "f-menu-key", shortcut));
    button.onmousedown = (event) => event.preventDefault();
    button.onclick = () => {
      hideMenu();
      action();
    };
    $menu.append(button);
  }
  $menu.hidden = false;
  const { width, height } = $menu.getBoundingClientRect();
  $menu.style.left = `${Math.max(4, Math.min(x, innerWidth - width - 4))}px`;
  $menu.style.top = `${Math.max(4, Math.min(y, innerHeight - height - 4))}px`;
}

function hideMenu() {
  if ($menu) $menu.hidden = true;
}

function menuShown() {
  return $menu != null && !$menu.hidden;
}

/// Copy Path: the path as text (the shell's clipboard, else the page's).
function copyPath(path) {
  invoke("copy_text", { text: path }).catch(() => navigator.clipboard?.writeText(path).catch(() => {}));
}

/// A result's clicks, as the Mac's FileDragArea: one selects it, two open it, pressed and moved it's dragged out as the
/// file (a copy, with its picture under the pointer), and the other button offers what to do with the file. The field
/// keeps the keyboard. `thumb()` is the path of a picture already rendered for it, if any.
function wireResult(item, hit, { select, open, reveal }) {
  // On Linux, WebKit's own drag with the file's address: GTK starts it from the press, as Wayland wants (a drag
  // started later is refused).
  if (isLinux) {
    item.draggable = true;
    item.ondragstart = (event) => {
      const address = "file://" + hit.path.split("/").map(encodeURIComponent).join("/");
      event.dataTransfer.setData("text/uri-list", address);
      event.dataTransfer.setData("text/plain", hit.path);
      event.dataTransfer.effectAllowed = "copy";
    };
  }
  // Elsewhere: pressed and moved a little, the system's drag (which needs the button down).
  item.onmousedown = (event) => {
    if (event.button !== 0 || isLinux) return;
    event.preventDefault();
    const [x, y] = [event.clientX, event.clientY];
    const moved = (move) => {
      if (Math.hypot(move.clientX - x, move.clientY - y) < 4) return;
      done();
      invoke("drag_out", { path: hit.path, icon: item.dataset.thumb || null }).catch(() => {});
    };
    const done = () => {
      window.removeEventListener("mousemove", moved);
      window.removeEventListener("mouseup", done);
    };
    window.addEventListener("mousemove", moved);
    window.addEventListener("mouseup", done);
  };
  item.onclick = () => select(hit);
  item.ondblclick = () => open(hit);
  item.oncontextmenu = (event) => {
    event.preventDefault();
    select(hit);
    showMenu(event.clientX, event.clientY, [
      [openTitle(hit), () => open(hit)],
      [`Show in ${FILE_MANAGER}`, () => reveal(hit)],
      null,
      ["Copy", () => invoke("copy_file", { path: hit.path }).catch(() => {}), `${MOD}C`],
      ["Copy Path", () => copyPath(hit.path)],
    ]);
  };
}
