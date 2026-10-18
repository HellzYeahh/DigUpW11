// Results as the helper sends them (`digup search-service`: hitFields in Sources/digup/SearchService.swift), with
// pictures for its renders, and a stand-in for its answers that the panel and window specs share.
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const HOME = "C:\\Users\\Yass";
const PICTURES = path.join(os.tmpdir(), "digup-ui-fixtures");

/// A PNG of `width` × `height`, a soft gradient between two colors (no packages: zlib and a CRC).
function png(file, width, height, [r1, g1, b1], [r2, g2, b2]) {
  if (fs.existsSync(file)) return file;
  const crcTable = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const stripe = (Math.floor(x / 24) + Math.floor(y / 24)) % 2 ? 1 : 0.92;
      row[1 + x * 3] = Math.round((r1 + (r2 - r1) * t) * stripe);
      row[2 + x * 3] = Math.round((g1 + (g2 - g1) * t) * stripe);
      row[3 + x * 3] = Math.round((b1 + (b2 - b1) * t) * stripe);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]));
  return file;
}

const RENDERS = {
  screenshot: png(path.join(PICTURES, "screenshot.png"), 480, 300, [235, 238, 245], [120, 140, 190]),
  image: png(path.join(PICTURES, "beach.png"), 400, 300, [250, 214, 140], [60, 140, 190]),
  video: png(path.join(PICTURES, "frame.png"), 480, 270, [40, 70, 60], [200, 160, 90]),
  pdf: png(path.join(PICTURES, "page.png"), 300, 400, [252, 252, 250], [225, 225, 230]),
};

const modified = Date.UTC(2026, 9, 7) / 1000;
const hit = (fields) => ({ score: 1, modified, size: 62_000, info: {}, segment_id: 1, z: 3, ...fields });

/// One of each kind: what a search for "receipt" might find.
const HITS = [
  hit({ path: `${HOME}\\Pictures\\Screenshots\\Screenshot 2026-10-07 142233 payment error.png`, kind: "screenshot",
        segment: "image", segment_id: 11, info: { width: "1440", height: "900" } }),
  hit({ path: `${HOME}\\Pictures\\Holiday\\beach dog.jpg`, kind: "image", segment: "image", segment_id: 12,
        info: { width: "4032", height: "3024" }, size: 3_400_000 }),
  hit({ path: `${HOME}\\Documents\\Receipts\\hardware store receipt.pdf`, kind: "pdf", segment: "page", loc: 3,
        segment_id: 13, keyword_rank: 1, excerpt: "Total due «receipt» 42.10 paid by card", info: { pages: "4" } }),
  hit({ path: `${HOME}\\Documents\\Notes\\budget meeting.docx`, kind: "doc", segment: "chunk", loc: 2, segment_id: 14,
        keyword_rank: 2, excerpt: "the «receipt» for the venue goes to finance", info: { chunks: "5" } }),
  hit({ path: `${HOME}\\Videos\\dog on the beach.mp4`, kind: "video", segment: "frame", loc: 6, loc_end: 9,
        segment_id: 15, info: { duration: "72", width: "1920", height: "1080" }, size: 24_000_000 }),
  hit({ path: `${HOME}\\Music\\Voice memo laughing.m4a`, kind: "audio", segment: "audio", loc: 25, loc_end: 55,
        segment_id: 16, info: { duration: "192" }, size: 2_100_000 }),
];

const CODE_HITS = [
  hit({ path: "C:\\Code\\billing\\payments\\retry.ts", kind: "code", segment: "lines", loc: 12, loc_end: 40, focus: 14,
        segment_id: 21, keyword_rank: 1, excerpt: "export async function «retry»(request, attempts = 5) {",
        info: { repo: "C:\\Code\\billing", lines: "120" } }),
  hit({ path: "C:\\Code\\billing\\net\\backoff.ts", kind: "code", segment: "lines", loc: 1, loc_end: 20, segment_id: 22,
        excerpt: "const delay = base * 2 ** attempt", info: { repo: "C:\\Code\\billing", lines: "44" } }),
];

const TEXTS = {
  14: "Budget meeting, October.\n\nWe agreed the receipt for the venue goes to finance by Friday. The catering "
    + "quote is still open, and the slides about the budget need the new numbers before the board sees them.",
  21: Array.from({ length: 29 }, (_, i) => i === 2 ? "export async function retry(request, attempts = 5) {"
    : i === 3 ? "  for (let attempt = 0; attempt < attempts; attempt++) {" : `  // line ${12 + i}`).join("\n"),
};

/// The page's init script: the fixtures, and `ask` answering as the helper does. `__fixtures.delay` holds a
/// meaning search's reply back (ms); every request is kept with when it went out (`__asked`).
function helperScript({ hits = HITS, codeHits = CODE_HITS, strong, meaning = true, delay = 0 } = {}) {
  const roots = [{ path: `${HOME}\\Pictures`, kinds: { screenshot: 136, image: 104, pdf: 25, doc: 12, audio: 6, video: 9 } }];
  const data = { hits, codeHits, strong: strong ?? hits.length, meaning, delay, renders: RENDERS, texts: TEXTS, roots };
  return `
    window.__fixtures = ${JSON.stringify(data)};
    window.__asked = [];
    window.__mock = window.__mock || { responses: {} };
    window.__mock.responses.ask = async ({ request }) => {
      const f = window.__fixtures;
      window.__asked.push({ ...request, at: performance.now() });
      switch (request.op) {
        case "search": {
          const all = request.code ? f.codeHits : f.hits;
          const kinds = request.kinds;
          const hits = (kinds ? all.filter((hit) => kinds.includes(hit.kind)) : all).filter((hit) => request.meaning
            || hit.keyword_rank != null || /screenshot/i.test(hit.path));
          if (request.meaning && f.delay) await new Promise((done) => setTimeout(done, f.delay));
          const strong = request.code ? hits.length : Math.min(hits.length, f.strong);
          return { hits, strong, meaning: request.meaning && f.meaning };
        }
        case "render": return { image: f.renders[request.kind === "image" ? (/beach/.test(request.path) ? "image" : "screenshot") : request.kind] };
        case "text": return { text: f.texts[request.segment] ?? null };
        case "summaries": return { roots: f.roots };
        default: return { ok: true };
      }
    };
  `;
}

/// The shell's state snapshot (status.rs, main.rs's Shell::snapshot) for a quiet, indexed DigUp.
const STATE = {
  line: "1,204 files indexed", progress: null, caveat: null, indexing: null, files: 1204, searchable: 1204, pending: 0,
  unfinished: 0, measuring: false, paused: false, heldUntil: null, badge: null, busy: false, activity: "idle",
  model: { state: "ready" }, hasCode: true, hasFolders: true, editor: "Visual Studio Code", update: null,
};

module.exports = { HITS, CODE_HITS, STATE, HOME, RENDERS, helperScript };
