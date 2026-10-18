#!/usr/bin/env python3
"""Times DigUp on this computer next to the Mac app's own numbers (the M4 Pro the engine's estimates were measured on):
the model on each kind of input, indexing a made-up folder of notes, pictures, screenshots and recordings, a search
from typed words to results, and on Windows the search panel opening on its shortcut. Writes a Markdown report.

    scripts/bench.py --helper <digup or digup.exe> --models <folder> [--app <DigUp.exe>] [--out report.md]

--models holds the model files (downloaded there when missing, as scripts/check-windows-package.sh does). --app, on
Windows: the installed DigUp.exe, for the panel's timing (it needs a desktop to show on; without one, that row says
so). The packages workflow runs it on the installed app after checking the installer. A GitHub runner has no GPU and
four slow cores, so its times are a floor for a real PC, not what one sees.
"""
import argparse
import json
import os
import shutil
import statistics
import struct
import subprocess
import sys
import tempfile
import time
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# The Mac's numbers, from the engine's own measurements on an M4 Pro (Metal, Q8_0).
# Sources/digup/ModelSpeed.swift `baseline` (2026-10-13): seconds for one embedding of each input.
MAC_MODEL = {"text": 0.026, "picture": 0.123, "screen": 0.265, "sound": 0.220}
# Sources/DigUpKit/Estimator.swift `Costs` (2026-10-07): seconds of indexing per unit, reading included. A screenshot's
# includes Vision's OCR running alongside (0.24 s), which Windows doesn't do yet.
MAC_INDEXING = {"image": 0.12, "screenshot": 0.32, "docChunk": 0.045, "audioSecond": 0.0089}
UNITS = {"image": "picture", "screenshot": "screenshot", "docChunk": "chunk of text", "audioSecond": "second of audio"}
# Sources/DigUpApp/Engine.swift: a query's embedding takes ~6 ms with the GPU awake (the panel keeps it awake).
MAC_QUERY_EMBED_MS = 6
TYPING_PAUSE_MS = 120   # shell/ui/panel.js: meaning results come once typing pauses this long

QUERIES = ["lemon cake recipe", "how long to bake", "a dog on the beach", "meeting notes about the budget",
           "someone speaking", "a screenshot of settings", "train timetable", "invoice from the plumber"]

TOPICS = [
    ("Lemon cake", "Cream the butter and sugar, beat in three eggs, then fold in the flour, the zest of two lemons and "
     "a splash of milk. Bake for forty minutes at 180 degrees and pour the lemon syrup over it while it is warm."),
    ("Budget meeting", "We went through the quarter's spending line by line. Travel came in under budget, software "
     "over, and the team agreed to review subscriptions before renewing any of them next month."),
    ("Plumber invoice", "Replaced the kitchen tap and the washer under the bathroom sink. Parts 48.20, labour two "
     "hours at 55.00 an hour. Payment due within thirty days by bank transfer."),
    ("Train times", "The 7:42 to the city stops at every station until the junction, then runs fast. On weekends the "
     "first train leaves at 8:15 and the last one back is at 23:50."),
    ("Garden plan", "Tomatoes along the south fence, beans up the trellis, and the herbs in pots by the kitchen door "
     "where they get the morning sun. Water deeply twice a week rather than a little every day."),
    ("Trip packing list", "Passport, charger, two adapters, rain jacket, walking shoes, the blue notebook, and the "
     "printed booking for the first night in case the phone runs out of battery."),
]


def png(path, width, height, seed):
    """A picture of its own (a gradient with stripes, different for each seed), written with zlib alone."""
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(0, width, 8):
            r = (x * 255 // width + seed * 37) % 256
            g = (y * 255 // height + seed * 91) % 256
            b = 255 if (x // 40 + y // 40 + seed) % 2 else 64
            row += bytes((r, g, b)) * 8
        rows.append(bytes(row[: 1 + width * 3]))
    raw = zlib.compress(b"".join(rows), 6)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


def make_folder(folder):
    """Notes, pictures, screenshots and recordings, each file different (nothing is skipped as a copy)."""
    folder.mkdir(parents=True)
    reference = REPO / "Tests/LlamaRuntimeTests/Reference"
    counts = {"notes": 0, "pictures": 0, "screenshots": 0, "recordings": 0}
    for n in range(96):
        title, text = TOPICS[n % len(TOPICS)]
        (folder / f"note {n:03} {title.lower()}.txt").write_text(f"{title} ({n})\n\n{text}\n\n" + f"Entry {n}. " * 20)
        counts["notes"] += 1
    photo = (reference / "photo.jpg").read_bytes()
    for n in range(8):   # the same photo, its bytes made distinct after the end of the JPEG
        (folder / f"photo {n}.jpg").write_bytes(photo + b"\0" * (n + 1))
        png(folder / f"drawing {n}.png", 800, 600, n)
        counts["pictures"] += 2
    screen = (reference / "screen.png").read_bytes()
    for n in range(8):
        (folder / f"Screenshot 2026-10-18 at 09.{n:02}.00.png").write_bytes(screen + b"\0" * (n + 1))
        counts["screenshots"] += 1
    speech = (reference / "speech.wav").read_bytes()
    for n in range(4):
        (folder / f"voice memo {n}.wav").write_bytes(speech + b"\0" * (2 * (n + 1)))
        counts["recordings"] += 1
    return counts


def run(command, env, timeout=3600):
    started = time.perf_counter()
    result = subprocess.run(command, env=env, capture_output=True, encoding="utf-8", errors="replace", timeout=timeout)
    if result.returncode != 0:
        sys.exit(f"bench: {' '.join(map(str, command[:2]))} failed:\n{result.stdout[-2000:]}\n{result.stderr[-2000:]}")
    return result.stdout, time.perf_counter() - started


def last_json(text):
    for line in reversed(text.splitlines()):
        if line.startswith("{"):
            return json.loads(line)
    return {}


class Service:
    """`digup search-service`, the searcher the panel asks (JSON lines)."""

    def __init__(self, helper, folder, index, env):
        self.process = subprocess.Popen([helper, "search-service", folder, "--index", index], env=env,
                                        encoding="utf-8", errors="replace", stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.next = 0

    def ask(self, **request):
        self.next += 1
        request["id"] = self.next
        started = time.perf_counter()
        self.process.stdin.write(json.dumps(request) + "\n")
        self.process.stdin.flush()
        while True:
            line = self.process.stdout.readline()
            if not line:
                sys.exit("bench: the search service quit")
            reply = json.loads(line)
            if reply.get("id") == self.next:
                return reply, (time.perf_counter() - started) * 1000

    def close(self):
        try:
            self.ask(op="quit")
        finally:
            self.process.wait(timeout=30)


def search_times(helper, folder, index, env):
    service = Service(helper, str(folder), str(index), env)
    try:
        started = time.perf_counter()
        service.ask(op="prewarm")
        while service.ask(op="status")[0].get("encoder") not in ("ready", "unavailable"):
            if time.perf_counter() - started > 300:
                sys.exit("bench: the encoder never got ready")
            time.sleep(0.02)
        warm = time.perf_counter() - started
        words, cold, typed, embeds = [], [], [], []
        for query in QUERIES:
            words.append(service.ask(op="search", q=query, meaning=False, prefix_last=True, limit=40)[1])
            reply, ms = service.ask(op="search", q=query, meaning=True, limit=40)
            cold.append(ms)
            embeds.append(reply.get("ms", {}).get("embed", 0))
            # As the panel does: the words are embedded while typing, so the pause is most of the wait.
            again = query + " please"
            service.ask(op="embed_ahead", q=again)
            time.sleep(TYPING_PAUSE_MS / 1000)
            typed.append(service.ask(op="search", q=again, meaning=True, limit=40)[1])
        return {"warm": warm, "words": statistics.median(words), "cold": statistics.median(cold),
                "typed": statistics.median(typed), "embed": statistics.median(embeds)}
    finally:
        service.close()


def panel_times(app, index, models, settings, folder, env):
    """Sets DigUp up hidden, starts it in the tray, then times its shortcut until the panel shows (bench-panel.ps1)."""
    common = ["--index", str(index), "--models", str(models), "--settings", str(settings)]
    # Setup, hidden, as scripts/check-windows-package.sh does it; DigUp prints a report when it's done. Without a
    # desktop it may not quit after that, so it's ended.
    setup = subprocess.Popen([app, *common, "--offer", str(folder), "--hotkey", "Ctrl+Alt+Shift+D", "--debug-setup",
                              "--debug-query", "lemon cake", "--debug-quit"], env=env, encoding="utf-8",
                             errors="replace", stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    report = None
    for line in setup.stdout:
        if line.startswith("{"):
            report = line
            break
    try:
        setup.wait(timeout=60)
    except subprocess.TimeoutExpired:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(setup.pid)], capture_output=True)
    if not report:
        return {"why": "DigUp's hidden setup didn't finish"}
    tray = subprocess.Popen([app, *common, "--hotkey", "Ctrl+Alt+Shift+D", "--at-login"], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(15)   # its start, the helpers', the shortcut registered
        out, _ = run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                      str(REPO / "scripts/bench-panel.ps1"), "-ProcessId", str(tray.pid)], env, timeout=300)
        return last_json(out)
    finally:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(tray.pid)], capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--helper", required=True)
    parser.add_argument("--models", required=True)
    parser.add_argument("--app", help="Windows: the installed DigUp.exe, for the panel's timing")
    parser.add_argument("--out", default="bench.md")
    args = parser.parse_args()
    env = dict(os.environ, DIGUP_MODELS=str(Path(args.models).resolve()))
    work = Path(tempfile.mkdtemp(prefix="digup-bench-"))
    try:
        measure(args, env, work)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def measure(args, env, work):
    folder, index = work / "files", work / "index"
    counts = make_folder(folder)
    lines = ["# DigUp speed next to the Mac app", ""]
    lines += [f"Measured {time.strftime('%Y-%m-%d %H:%M')} on {os.environ.get('RUNNER_NAME', 'this computer')} "
              f"({os.cpu_count()} logical processors). The Mac's numbers are the engine's own, measured on an M4 Pro "
              "(DigUp's reference Mac). A ratio of 2 means twice as long as the Mac.", ""]

    # The model on each kind of input, the way setup times it (digup speed --model).
    out, _ = run([args.helper, "speed", "--model", "--json", "--index", str(index)], env)
    model = last_json(out)
    seconds = model.get("seconds", {})
    lines += [f"## The model (runs on the {'GPU' if model.get('device') == 'gpu' else 'processor'})", "",
              "| One embedding of | Here | Mac | Ratio |", "|---|---|---|---|"]
    for name, mac in MAC_MODEL.items():
        if name in seconds:
            lines.append(f"| {name} | {seconds[name]:.3f} s | {mac:.3f} s | ×{seconds[name] / mac:.1f} |")
    lines.append(f"\nThe model loaded in {model.get('load', 0):.1f} s.\n")

    # Indexing the folder from scratch, and what it measured kind by kind (costs.json beside the index).
    out, took = run([args.helper, "index", str(folder), "--index", str(index)], env)
    files = sum(counts.values())
    tallies = json.loads((index / "costs.json").read_text()).get("tallies", {})
    mac_total = sum(MAC_INDEXING[name] * tally["units"] for name, tally in tallies.items() if name in MAC_INDEXING)
    lines += ["## Indexing", "",
              f"{files} files ({', '.join(f'{n} {kind}' for kind, n in counts.items())}) in {took:.1f} s, "
              f"{files / took:.2f} files a second. The Mac's costs come to {mac_total:.1f} s for the same work "
              f"(×{took / mac_total:.1f}).", "", "| Each | Here | Mac | Ratio |", "|---|---|---|---|"]
    for name, mac in MAC_INDEXING.items():
        tally = tallies.get(name)
        if tally and tally["units"] > 0:
            each = tally["seconds"] / tally["units"]
            lines.append(f"| {UNITS[name]} | {each:.3f} s | {mac:.3f} s | ×{each / mac:.1f} |")
    lines.append("")

    # Searching: the panel's two steps (words at once, then meaning when typing pauses).
    times = search_times(args.helper, folder, index, env)
    lines += ["## Searching", "", "| | Here | Mac |", "|---|---|---|",
              f"| Model ready after the panel opens (cold) | {times['warm']:.1f} s | |",
              f"| First results (words, as you type) | {times['words']:.1f} ms | |",
              f"| Embedding the words | {times['embed']:.0f} ms | ~{MAC_QUERY_EMBED_MS} ms |",
              f"| Meaning results after typing pauses | {TYPING_PAUSE_MS} + {times['typed']:.0f} ms | "
              f"{TYPING_PAUSE_MS} + ~{MAC_QUERY_EMBED_MS} ms |",
              f"| A meaning search with nothing embedded ahead | {times['cold']:.0f} ms | |", ""]

    if args.app:
        # A few notes of its own to set up with: setup indexes what it's offered, and the panel's timing needs none.
        small = work / "panel"
        small.mkdir()
        for title, text in TOPICS:
            (small / f"{title.lower()}.txt").write_text(f"{title}\n\n{text}\n")
        panel = panel_times(args.app, work / "app-index", Path(args.models).resolve(), work / "settings.json",
                            small, env)
        lines += ["## The panel", ""]
        if panel.get("shown"):
            then = f", then {panel['median']:.0f} ms (median of {panel['shown'] - 1})" if panel["shown"] > 1 else ""
            lines.append(f"From the shortcut to the panel on screen: first time {panel['first']:.0f} ms{then}. The "
                         "Mac app has no recorded figure to compare with yet.")
        else:
            lines.append(f"Not measured: {panel.get('why', 'the panel never showed')}.")
        lines.append("")
    report = "\n".join(lines)
    Path(args.out).write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
