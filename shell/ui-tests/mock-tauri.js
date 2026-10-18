// A stand-in for Tauri's global API (window.__TAURI__) for the pages under test. Each command answers from
// window.__mock.responses (a value, or a function of the arguments; a missing one answers null), every call is kept in
// window.__mock.calls, and window.__mock.emit(name, payload) delivers an event to the page's listeners. Tests set the
// responses before the page loads, with page.addInitScript.
(() => {
  const listeners = {};
  const mock = window.__mock = window.__mock || {};
  mock.responses = mock.responses || {};
  mock.calls = [];
  mock.platform = mock.platform || "Win32";
  Object.defineProperty(navigator, "platform", { get: () => mock.platform });
  mock.emit = (name, payload) => (listeners[name] || []).forEach((handler) => handler({ event: name, payload }));
  mock.callsTo = (command) => mock.calls.filter((call) => call.command === command).map((call) => call.args);
  window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        mock.calls.push({ command, args });
        const answer = mock.responses[command];
        const value = typeof answer === "function" ? await answer(args || {}) : answer;
        if (value instanceof Error) throw value.message;
        return value === undefined ? null : value;
      },
      convertFileSrc: (path) => (path.startsWith("/") || /^[A-Z]:/i.test(path) ? "file://" + path.replace(/\\/g, "/") : path),
    },
    event: {
      listen: async (name, handler) => {
        (listeners[name] = listeners[name] || []).push(handler);
        return () => { listeners[name] = listeners[name].filter((other) => other !== handler); };
      },
    },
    path: { homeDir: async () => "C:\\Users\\Yass" },
  };
})();
