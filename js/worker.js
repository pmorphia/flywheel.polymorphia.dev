/* Runs Flywheel programs off the main thread, so a runaway loop can be stopped by terminating
 * the worker. The interpreter stays alive after a run so event handlers in the app preview can
 * call back into the program (as in `flywheel desktop`); the app re-renders after each event.
 * flywheel.js is a copy of github.com/fwlang/flywheel.js; update it from there. */
importScripts("flywheel.js");

let I = null, appRoot = null, handlers = [], session = null, buffer = [], runId = 0;

function flush() { if (buffer.length) { postMessage({ type: "out", id: runId, lines: buffer }); buffer = []; } }
function print(s) { buffer.push({ s }); if (buffer.length >= 200) flush(); }
function error(s) { buffer.push({ s, err: true }); if (buffer.length >= 200) flush(); }

// The preview document: <head> content, <body> attributes and content. Event attributes holding
// Flywheel functions become data-fw-on* hooks whose numbers index `handlers`.
function renderApp() {
  if (!appRoot) return null;
  handlers = [];
  const hooks = (el, attr, fn) => { handlers.push(fn); return ` data-fw-${attr.toLowerCase()}="${handlers.length - 1}"`; };
  const inner = el => el.children.map(c => typeof c === "string" ? I.render(c) : I.render(c, hooks)).join("");
  let head = "", body, bodyAttrs = "", title = null;
  if (appRoot.tag === "html") {
    const h = appRoot.children.find(c => c && c.tag === "head");
    const b = appRoot.children.find(c => c && c.tag === "body");
    if (h) head = h.children.map(c => I.render(c)).join("");
    if (b) {
      const open = /^<body([^>]*)>/.exec(I.render(b));
      bodyAttrs = open ? open[1] : "";
      body = inner(b);
    } else body = appRoot.children.filter(c => !(c && c.tag === "head")).map(c => I.render(c, hooks)).join("");
  } else body = I.render(appRoot, hooks);
  const t = appRoot.tag === "title" ? appRoot : I.query(appRoot, "title", false);
  if (t) title = I.elText(t);
  return { head, body, bodyAttrs, title, isDoc: appRoot.tag === "html", page: I.render(appRoot) };
}

onmessage = e => {
  const m = e.data;
  if (m.type === "run") {
    runId = m.id;
    const t0 = performance.now();
    appRoot = null; handlers = [];
    let r;
    try { r = Flywheel.run(m.code, { print, error, name: "main.fw", stdin: m.stdin }); }
    catch (err) { error("flywheel.js internal error: " + (err && err.message || err)); r = { status: 1 }; }
    I = r.interp || null;
    if (r.value instanceof Flywheel.FwElement) appRoot = r.value;
    const ms = performance.now() - t0;
    flush();
    let app = null;
    try {
      if (appRoot) app = renderApp();
      else if (r.html != null) app = { head: "", body: r.html, bodyAttrs: "", title: null, isDoc: /<html/i.test(r.html), page: r.html };
      else if (r.text != null) { const t = "<pre>" + r.text.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</pre>"; app = { head: "", body: t, bodyAttrs: "", title: null, isDoc: false, page: t }; }
    } catch (err) { error("could not render the app: " + (err && err.message || err)); }
    flush();
    postMessage({ type: "done", id: m.id, status: r.status, ms, app, served: r.served || null, window: r.window ? r.window.title : null });
  } else if (m.type === "event") {
    runId = m.id;
    const fn = handlers[m.hid];
    if (!I || !fn) return;
    const params = fn instanceof Flywheel.FwFunc ? fn.params : fn instanceof Flywheel.Bound ? fn.fn.params : [];
    const err = I.callFromHost(fn, params.length ? [m.value == null ? "" : String(m.value)] : []);
    if (err) error(err);
    flush();
    let app = null;
    try { app = renderApp(); } catch (er) { error("could not render the app: " + (er && er.message || er)); }
    flush();
    postMessage({ type: "app", id: m.id, app });
  } else if (m.type === "repl") {
    runId = m.id;
    if (!session) session = new Flywheel.Session({ print, error });
    try { session.exec(m.code); } catch (err) { error("flywheel.js internal error: " + (err && err.message || err)); }
    flush();
    postMessage({ type: "done", id: m.id, status: 0, repl: true });
  } else if (m.type === "repl-reset") session = null;
};
