// Diagnostic: each DigUp page's state over WebView2's DevTools port.
const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json().catch(() => []);
const expression = `JSON.stringify({
  url: location.href, ready: document.readyState, visibility: document.visibilityState, hasFocus: document.hasFocus(),
  active: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
  query: document.getElementById("query") && document.getElementById("query").value,
  glass: !!document.getElementById("glass"), bodyBg: getComputedStyle(document.body).backgroundColor,
  panelBg: document.getElementById("panel") && getComputedStyle(document.getElementById("panel")).backgroundColor,
  panelClass: document.getElementById("panel") && document.getElementById("panel").className,
  html: document.documentElement.className, size: [innerWidth, innerHeight], errors: window.__errors || []
})`;
for (const target of targets.filter((t) => t.type === "page")) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 5000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression } }));
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) { clearTimeout(timer); resolve(message.result?.result?.value ?? JSON.stringify(message)); }
    };
    ws.onerror = () => resolve("error");
  });
  ws.close();
  console.log(target.url, result);
}
if (!targets.length) console.log("no DevTools targets");
