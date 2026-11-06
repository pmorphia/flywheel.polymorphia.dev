/* flywheel.polymorphia.dev — playground, live app preview, pmsh, lessons and docs. */
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const eio = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};
const POLY = "https://polymorphia.dev";
const EMAIL = "hello@polymorphia.dev";
const INSTALL = {
  linux: {
    kind: "sh", label: "Linux", url: "install.sh", file: "install.sh",
    cmd: "curl -fsSL https://flywheel.polymorphia.dev/install.sh | bash",
    all: "curl -fsSL https://flywheel.polymorphia.dev/install.sh | bash -s -- --all",
    src: 'git clone https://github.com/fwlang/flywheel && cd flywheel\ncmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DLLVM_DIR="$(llvm-config --cmakedir)"\ncmake --build build --parallel',
    run: "in a terminal",
    note: "Builds with your distribution's LLVM 21–23 and CMake; asks before using sudo for packages.",
  },
  windows: {
    kind: "ps1", label: "Windows", url: "install.ps1", file: "install.ps1",
    cmd: "irm https://flywheel.polymorphia.dev/install.ps1 | iex",
    all: "& ([scriptblock]::Create((irm https://flywheel.polymorphia.dev/install.ps1))) -All",
    src: 'git clone https://github.com/fwlang/flywheel; cd flywheel\ncmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DLLVM_DIR="<path to LLVM>\\lib\\cmake\\llvm"\ncmake --build build --parallel',
    run: "in PowerShell",
    note: "No administrator rights needed; it fetches LLVM, CMake and Ninja privately. To build by hand use an x64 Visual Studio developer shell.",
  },
  macos: {
    kind: "sh", label: "macOS", url: "install.sh", file: "install.sh",
    cmd: "curl -fsSL https://flywheel.polymorphia.dev/install.sh | bash",
    all: "curl -fsSL https://flywheel.polymorphia.dev/install.sh | bash -s -- --all",
    src: 'git clone https://github.com/fwlang/flywheel && cd flywheel\ncmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DLLVM_DIR="$(brew --prefix llvm)/lib/cmake/llvm" -DCMAKE_PREFIX_PATH="$(brew --prefix)"\ncmake --build build --parallel',
    run: "in Terminal",
    note: "Builds with Homebrew's LLVM 21–23, CMake and Ninja, and Apple's Command Line Tools; offers to install them first. No sudo needed.",
  },
};
// Flywheel Lite: the bytecode VM. It needs only a C compiler, so it installs quickly.
const LITE_SH = "curl -fsSL https://flywheel.polymorphia.dev/lite-install.sh | bash";
const LITE_INSTALL = {
  linux: {
    kind: "sh", label: "Linux", url: "lite-install.sh", file: "lite-install.sh", cmd: LITE_SH,
    src: "git clone https://github.com/fwlang/flywheel && cd flywheel\ngit clone https://github.com/fwlang/flywheel-lite && cd flywheel-lite\nmake && make install PREFIX=~/.local   # flywheel-lite + fwl",
    run: "in a terminal",
    note: "Needs only a C compiler and make; asks before using sudo to install them.",
  },
  windows: {
    kind: "ps1", label: "Windows", url: "lite-install.ps1", file: "lite-install.ps1",
    cmd: "irm https://flywheel.polymorphia.dev/lite-install.ps1 | iex",
    src: "git clone https://github.com/fwlang/flywheel; cd flywheel\ngit clone https://github.com/fwlang/flywheel-lite; cd flywheel-lite\ncmake -S . -B build\ncmake --build build --config Release",
    run: "in PowerShell",
    note: "No administrator rights needed. Builds with Visual Studio's C compiler, or MinGW gcc if that is on PATH; offers to install the Build Tools if neither is found.",
  },
  macos: {
    kind: "sh", label: "macOS", url: "lite-install.sh", file: "lite-install.sh", cmd: LITE_SH,
    src: "git clone https://github.com/fwlang/flywheel && cd flywheel\ngit clone https://github.com/fwlang/flywheel-lite && cd flywheel-lite\nmake && make install PREFIX=~/.local   # flywheel-lite + fwl",
    run: "in Terminal",
    note: "Builds with Apple's Command Line Tools (clang and make) and offers to install them if they are missing.",
  },
};
const JS_INSTALL = {
  tag: '<script src="https://flywheel.polymorphia.dev/js/flywheel.js"></script>\n<script>\n  Flywheel.run(\'print "Hello from {1 + 1} worlds"\', { print: console.log });\n</script>',
  npx: "npx github:fwlang/flywheel.js run main.fw",
  npm: "npm install github:fwlang/flywheel.js",
  file: "js/flywheel.js",
};
const platform = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "").toLowerCase();
const OS = /win/.test(platform) ? "windows" : /mac|iphone|ipad/.test(platform) ? "macos" : "linux";

const LESSONS = [
  { id: "01-hello", title: "Hello, Flywheel" },
  { id: "02-control-flow", title: "Control flow" },
  { id: "03-functions", title: "Functions and lambdas" },
  { id: "04-collections", title: "Collections" },
  { id: "05-classes", title: "Classes and interfaces" },
  { id: "06-enums-match", title: "Enums and pattern matching" },
  { id: "07-errors", title: "Errors, Results and defer" },
  { id: "08-markup", title: "Markup and components" },
  { id: "09-apps", title: "Building an app" },
];
const DOCS = [
  { id: "overview", title: "Overview", group: "Start" },
  { id: "playground", title: "The playground", group: "Start" },
  { id: "language", title: "Language decisions", group: "Language" },
  { id: "types", title: "Types and classes", group: "Language" },
  { id: "collections", title: "Collections", group: "Language" },
  { id: "value-conversions", title: "Conversions", group: "Language" },
  { id: "errors", title: "Errors and Results", group: "Language" },
  { id: "html-dom", title: "HTML tools", group: "Language" },
  { id: "modules", title: "Modules", group: "Language" },
  { id: "library", title: "Library reference", group: "Libraries" },
  { id: "input-processes", title: "Input and processes", group: "Libraries" },
  { id: "concurrency", title: "Concurrency", group: "Libraries" },
  { id: "desktop", title: "Desktop windows", group: "Libraries" },
  { id: "runtime", title: "Runtime and memory", group: "Libraries" },
  { id: "tooling", title: "Tooling", group: "Tools" },
];

/* ================================================================ toast */
const toastEl = $("#toast");
let toastTimer = 0;
function toast(html, ms = 2600) {
  toastEl.innerHTML = html; toastEl.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("on"), ms);
}

/* ================================================================ the logo: hand-off and idle spin */
const mark = $("#mark"), dock = $("#markDock"), slot = $("#markSlot");
const IDLE = 14;
let angle = 0, omega = IDLE, hoverBrand = false, flight = null, leaving = null;
const ho = window.__handoff;
const handoffSize = () => Math.round(Math.min(innerWidth, innerHeight, 800) * .3);

// Embedded in polymorphia.dev for the first stage of the hand-off (see index.html): wait for its
// "go", then report the flight so it can play the matching sound, and say when everything has
// settled so it can navigate here for real.
const embed = window.__embed, resume = window.__resume;
let relay = null;
const tell = m => { if (embed) parent.postMessage(m, embed); };
function arrive(h) {
  angle = h.a + h.w * clamp((Date.now() - h.t) / 1000, 0, 1.5);
  omega = h.w || 240;
  const S = h.s || handoffSize();
  flight = { t: -0.12, S, from: null };
  mark.style.width = mark.style.height = S + "px";
  placeMark(innerWidth / 2, innerHeight / 2, 1);
  dock.style.visibility = "hidden";
  // reveal the interface around the travelling logo
  const uis = $$(".ui");
  uis.forEach((el, i) => setTimeout(() => { el.classList.add("in"); tell({ type: "fw-ui", i, n: uis.length }); }, 260 + i * 70));
  setTimeout(() => {
    document.documentElement.classList.remove("arrive");
    tell({ type: "fw-settled", a: +(angle % 360).toFixed(2), w: +omega.toFixed(1), t: Date.now() });
  }, 260 + uis.length * 70 + 800);
}
if (ho) arrive(ho);
else if (resume) {
  // the real page after the iframe stage: carry on from the iframe's last frame
  angle = resume.a + resume.w * clamp((Date.now() - resume.t) / 1000, 0, 1);
  omega = resume.w || IDLE;
}
if (embed) {
  addEventListener("message", e => {
    if (e.origin !== embed || !e.data || e.data.type !== "pm-go" || relay) return;
    relay = { live: false };
    document.documentElement.classList.remove("embed-wait");
    arrive(e.data);
  });
  // ready once the logo and the fonts can paint on the first frame
  Promise.all([document.fonts.ready, mark.decode ? mark.decode().catch(() => {}) : null]).then(() => tell({ type: "fw-ready" }));
}
function placeMark(cx, cy, scale) {
  const S = parseFloat(mark.style.width) || 1;
  mark.style.transform = `translate(${cx - S / 2}px, ${cy - S / 2}px) rotate(${angle % 360}deg) scale(${scale})`;
}
let last = performance.now();
function spin(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const goal = leaving ? 260 : hoverBrand ? 300 : IDLE;
  omega += (goal - omega) * (1 - Math.exp(-dt * (flight ? .9 : hoverBrand ? 2.2 : .8)));
  if (!reduced || flight || leaving) angle += omega * dt;
  if (flight) {
    flight.t += dt / 1.05;
    const r = slot.getBoundingClientRect();
    const k = eio(clamp(flight.t));
    const tx = r.left + r.width / 2, ty = r.top + r.height / 2;
    placeMark(lerp(innerWidth / 2, tx, k), lerp(innerHeight / 2, ty, k), lerp(1, r.width / flight.S, k));
    if (relay) {
      tell({ type: "fw-tick", k, w: omega });
      // our logo is on screen where polymorphia.dev's is: it can hide its own once this frame paints
      if (!relay.live) { relay.live = true; requestAnimationFrame(() => requestAnimationFrame(() => tell({ type: "fw-live" }))); }
    }
    if (flight.t >= 1) { flight = null; mark.style.display = "none"; dock.style.visibility = ""; tell({ type: "fw-docked" }); }
  }
  if (leaving) {
    leaving.t = Math.min(1, leaving.t + dt / .8);
    const k = eio(leaving.t), S = leaving.S;
    placeMark(lerp(leaving.x0, innerWidth / 2, k), lerp(leaving.y0, innerHeight / 2, k), lerp(leaving.w0 / S, 1, k));
    if (leaving.t >= 1 && !leaving.gone) {
      leaving.gone = true;
      const p = new URLSearchParams({ from: "fw", a: (angle % 360).toFixed(2), w: omega.toFixed(1), s: S, t: Date.now() });
      location.href = POLY + "/#" + p;
    }
  }
  dock.style.transform = `rotate(${angle % 360}deg)`;
  requestAnimationFrame(spin);
}
requestAnimationFrame(spin);
$(".brand").addEventListener("pointerenter", () => hoverBrand = true);
$(".brand").addEventListener("pointerleave", () => hoverBrand = false);

// back to polymorphia.dev: the reverse hand-off
function goPolymorphia() {
  if (reduced) { location.href = POLY + "/#main"; return; }
  if (leaving) return;
  const r = slot.getBoundingClientRect(), S = handoffSize();
  leaving = { t: 0, x0: r.left + r.width / 2, y0: r.top + r.height / 2, w0: r.width, S, gone: false };
  flight = null;
  mark.style.width = mark.style.height = S + "px";
  mark.style.display = "block"; dock.style.visibility = "hidden";
  placeMark(leaving.x0, leaving.y0, r.width / S);
  document.body.style.transition = "none";
  $$(".ui, main, header, dialog").forEach(el => { el.style.transition = "opacity .45s ease"; el.style.opacity = "0"; });
}
$("#back").addEventListener("click", e => { if (e.button || e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); goPolymorphia(); });
addEventListener("pageshow", e => {
  if (!e.persisted || !leaving) return;
  leaving = null; mark.style.display = "none"; dock.style.visibility = "";
  $$(".ui, main, header, dialog").forEach(el => { el.style.opacity = ""; });
});

/* ================================================================ highlighting */
const grammarReady = FwHighlight.fetch("grammar/flywheel.tmLanguage.json").then(() => { edRender(); rerenderProse(); }).catch(() => {});
const hlCode = code => FwHighlight.ready ? FwHighlight.highlight(code) : esc(code);

/* ================================================================ editor */
const ed = $("#ed"), edHl = $("#edHl"), gutter = $("#gutter"), edPos = $("#edPos"), edRun = $("#edRun"), fileName = $("#fileName");
let edRaf = 0, edLines = 0;
function edRender() {
  edRaf = 0;
  edHl.innerHTML = hlCode(ed.value) + "\n ";
  const n = ed.value.split("\n").length;
  if (n !== edLines) { edLines = n; gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n"); }
}
function edQueue() { if (!edRaf) edRaf = requestAnimationFrame(edRender); }
function edSet(code, name) {
  ed.value = code; ed.setSelectionRange(0, 0);
  if (name) fileName.textContent = name;
  edRender(); $("#edBody").scrollTop = 0;
}
function insert(text) {
  ed.focus();
  if (!document.execCommand("insertText", false, text)) ed.setRangeText(text, ed.selectionStart, ed.selectionEnd, "end");
}
function curLine() {
  const v = ed.value, s = ed.selectionStart;
  const ls = v.lastIndexOf("\n", s - 1) + 1, le = v.indexOf("\n", s);
  return { ls, le: le < 0 ? v.length : le, text: v.slice(ls, le < 0 ? v.length : le), col: s - ls };
}
const OPENS = /^\s*(?:(?:private|public)\s+)?(?:function\b(?!.*=>)|class\b|interface\b|enum\b|elements\b|component\b(?=.*<\w[^>]*>\s*$)|try\s*$|catch\b|finally\s*$|else\b|match\b|case\b.*\bthen\s*$|defer\s*$)|\b(?:then|do)\s*$|=\s*<(\w[\w.-]*)(?:\s[^>]*)?>\s*$|returns\s+\S+\s*$/;
ed.addEventListener("input", () => { edQueue(); saveCode(); });
ed.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key === "s")) { e.preventDefault(); runProgram(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === "/") {
    e.preventDefault();
    const l = curLine();
    ed.setSelectionRange(l.ls, l.le);
    insert(/^\s*#\s?/.test(l.text) ? l.text.replace(/^(\s*)#\s?/, "$1") : l.text.replace(/^(\s*)/, "$1# "));
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const l = curLine();
    if (e.shiftKey) {
      const m = /^ {1,4}/.exec(l.text);
      if (m) { const s = ed.selectionStart; ed.setSelectionRange(l.ls, l.ls + m[0].length); insert(""); ed.setSelectionRange(Math.max(l.ls, s - m[0].length), Math.max(l.ls, s - m[0].length)); }
    } else insert(" ".repeat(4 - (l.col % 4)));
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    const l = curLine(), before = l.text.slice(0, l.col);
    let indent = /^\s*/.exec(l.text)[0].slice(0, l.col);
    if (OPENS.test(before)) indent += "    ";
    insert("\n" + indent);
    return;
  }
});
ed.addEventListener("keyup", e => {
  // dedent a freshly typed `end` / `else` / `catch` / `finally` / `case`
  if (!/^[a-z]$/.test(e.key)) return;
  const l = curLine();
  const m = /^(\s+)(end|else|catch|finally|case)$/.exec(l.text);
  if (!m || l.col !== l.text.length) return;
  const prev = ed.value.slice(0, l.ls - 1).split("\n");
  for (let i = prev.length - 1; i >= 0; i--) {
    const p = prev[i];
    if (!p.trim()) continue;
    const pi = /^\s*/.exec(p)[0].length;
    const opener = OPENS.test(p);
    const want = Math.max(0, opener ? pi : pi - 4);
    if (m[1].length > want && (m[1].length - want) % 4 === 0 && (opener || m[1].length === pi)) {
      ed.setSelectionRange(l.ls, l.ls + m[1].length); insert(" ".repeat(want)); ed.setSelectionRange(l.ls + want + m[2].length, l.ls + want + m[2].length);
    }
    break;
  }
});
function edCaret() {
  const v = ed.value.slice(0, ed.selectionStart), line = v.split("\n").length;
  edPos.textContent = `Ln ${line}, Col ${ed.selectionStart - v.lastIndexOf("\n")}`;
}
["keyup", "click", "select", "input"].forEach(ev => ed.addEventListener(ev, edCaret));

/* which program the editor shows: the playground's own, or the current lesson's */
let editorOwner = "play";        // "play" | "lesson:<id>"
function saveCode() {
  if (editorOwner === "play") { store.set("fw.play", ed.value); store.set("fw.playName", fileName.textContent); }
  else store.set("fw." + editorOwner, ed.value);
}
const examples = window.FW_EXAMPLES;
const exSel = $("#examples");
exSel.innerHTML = `<option value="">examples…</option>` + examples.map(x => `<option value="${x.id}">${esc(x.name)} — ${esc(x.title)}</option>`).join("");
function loadExample(id, run) {
  const x = examples.find(e => e.id === id || e.name === id || e.name === id + ".fw");
  if (!x) return false;
  if (editorOwner !== "play") go("#/");
  edSet(x.code, x.name); saveCode();
  exSel.value = "";
  if (run) runProgram();
  return true;
}
exSel.addEventListener("change", () => { if (exSel.value) loadExample(exSel.value, true); });
$$("[data-example]").forEach(b => b.addEventListener("click", () => loadExample(b.dataset.example, true)));

/* share links: #/p/<base64url of the program> */
const b64e = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));
$("#shareBtn").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "#/p/" + b64e(ed.value);
  try { await navigator.clipboard.writeText(url); toast("Link to this program copied"); }
  catch (e) { toast(`Copy this link: <code>${esc(url.slice(0, 80))}…</code>`, 5000); }
});

/* ================================================================ running programs */
const appFrame = $("#appFrame"), preview = $("#preview"), appInfo = $("#appInfo"), appUrl = $("#appUrl"), appOpen = $("#appOpen");
const TIMEOUT = 6000;
let worker = null, seq = 0, pending = null, appId = 0, lastPage = "";
function getWorker() {
  if (!worker) { worker = new Worker("js/worker.js"); worker.onmessage = onWorker; worker.onerror = e => { term.err("playground worker error: " + (e.message || "failed to start")); }; }
  return worker;
}
function stopProgram(reason) {
  if (!pending) return false;
  clearTimeout(pending.timer);
  if (worker) { worker.terminate(); worker = null; }
  term.line(`<span class="o-err">■ ${esc(reason)}</span>`);
  setRunState(null);
  pending = null; appId = 0;
  return true;
}
function setRunState(text, cls) { edRun.className = cls || ""; edRun.textContent = text || ""; }
function runProgram(code) {
  if (code === undefined) code = ed.value;
  if (pending) stopProgram("stopped (re-run)");
  const id = ++seq;
  pending = { id, kind: "run", timer: setTimeout(() => stopProgram(`stopped: the program ran longer than ${TIMEOUT / 1000} s`), TIMEOUT) };
  term.line(`${term.ps1Html()} <span class="k-cmd">flywheel</span> <span class="k-arg">run</span> <span class="k-arg">${esc(fileName.textContent)}</span>`);
  setRunState("running…");
  getWorker().postMessage({ type: "run", id, code });
}
function onWorker(e) {
  const m = e.data;
  if (m.type === "out") { for (const l of m.lines) l.err ? term.err(l.s) : term.text(l.s); return; }
  if (pending && m.id === pending.id) { clearTimeout(pending.timer); pending = null; }
  if (m.type === "done") {
    const ok = m.status === 0;
    setRunState(`${ok ? "✓" : "✗"} exit ${m.status} · ${m.ms < 10 ? m.ms.toFixed(1) : Math.round(m.ms)} ms`, ok ? "ok" : "bad");
    if (!ok) term.line(`<span class="o-dim">exit status ${m.status}</span>`);
    if (m.app) { appId = m.id; showApp(m.app, m.served, m.window); } else clearApp(m.status === 0 ? "no app" : "error");
  } else if (m.type === "app") {
    if (m.app) updateApp(m.app);
  }
}
function sendEvent(hid, value) {
  if (!appId || !worker) return;
  const id = ++seq;
  pending = { id, kind: "event", timer: setTimeout(() => { stopProgram(`stopped: the event handler ran longer than ${TIMEOUT / 1000} s`); clearApp("stopped"); }, TIMEOUT) };
  worker.postMessage({ type: "event", id, hid, value });
}

/* ================================================================ app preview */
const BASE_CSS = `<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:16px;color:#111;background:#fff;line-height:1.5}</style>`;
const BRIDGE = `<script>(function(){
var T=["click","dblclick","input","change","submit","keydown","keyup","focus","blur","mouseover","mouseout","mouseenter","mouseleave","pointerdown","pointerup"];
T.forEach(function(t){document.addEventListener(t,function(e){var a="data-fw-on"+t,el=e.target;
while(el&&el.nodeType===1&&!el.hasAttribute(a))el=el.parentElement;if(!el||el.nodeType!==1)return;
if(t==="submit"||(t==="click"&&el.tagName==="A"))e.preventDefault();
var src="value" in el?el:e.target,v=src&&"value" in src?src.value:"";
parent.postMessage({fw:"event",hid:+el.getAttribute(a),value:v},"*");},true);});
document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");
if(a&&!a.hasAttribute("data-fw-onclick")){var h=a.getAttribute("href")||"";if(h.charAt(0)!=="#"){e.preventDefault();window.open(a.href,"_blank","noopener");}}});
document.addEventListener("submit",function(e){if(!e.target.hasAttribute("data-fw-onsubmit"))e.preventDefault();},true);
addEventListener("message",function(e){var m=e.data;if(!m||m.fw!=="update")return;
var a=document.activeElement,id=a&&a.id,s=null,en=null;try{s=a.selectionStart;en=a.selectionEnd}catch(_){}
var x=scrollX,y=scrollY;document.body.innerHTML=m.body;if(m.title!=null)document.title=m.title;
if(id){var n=document.getElementById(id);if(n){n.focus();try{if(s!=null)n.setSelectionRange(s,en)}catch(_){}}}scrollTo(x,y);});
})();<\/script>`;
function pageDoc(app, live) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    (app.isDoc ? "" : BASE_CSS) + (app.head || "") + (live ? BRIDGE : "") + `</head><body${app.bodyAttrs || ""}>${live ? app.body : (app.isDoc ? (app.page.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, app.body])[1] : app.page)}</body></html>`;
}
function showApp(app, served, win) {
  preview.srcdoc = pageDoc(app, true);
  lastPage = pageDoc(app, false);
  appFrame.classList.add("has-app");
  appInfo.textContent = (app.title ? `“${app.title}”` : "") + (served ? ` · web.serve("${served}")` : win ? " · desktop.window" : " · returned element");
  appUrl.textContent = served ? `http://127.0.0.1:8000${served}` : win ? `desktop.window "${win}"` : "flywheel desktop main.fw";
  appOpen.disabled = false;
}
function updateApp(app) {
  if (!preview.contentWindow) return;
  preview.contentWindow.postMessage({ fw: "update", body: app.body, title: app.title }, "*");
  lastPage = pageDoc(app, false);
  if (app.title) appInfo.textContent = appInfo.textContent.replace(/^“[^”]*”/, `“${app.title}”`);
}
function clearApp(why) {
  appFrame.classList.remove("has-app");
  preview.removeAttribute("srcdoc"); preview.src = "about:blank";
  appInfo.textContent = why === "error" ? "· program failed" : why === "stopped" ? "· stopped" : "preview";
  appUrl.textContent = "http://127.0.0.1:8000/";
  appOpen.disabled = true; lastPage = "";
}
addEventListener("message", e => {
  if (e.source !== preview.contentWindow) return;
  const m = e.data;
  if (m && m.fw === "event") sendEvent(m.hid, m.value);
});
appOpen.addEventListener("click", () => {
  if (!lastPage) return;
  const url = URL.createObjectURL(new Blob([lastPage], { type: "text/html" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});
$("#runBtn").addEventListener("click", () => runProgram());

/* ================================================================ pmsh */
const term = (() => {
  const out = $("#out"), input = $("#cmd"), hl = $("#hl"), menu = $("#menu"), body = $("#tbody"), ps1 = $("#ps1");
  const hist = JSON.parse(store.get("fw.hist", "[]")); let hIdx = hist.length, draft = "";
  let items = [], sel = -1, menuOff = false;
  let repl = null;                      // { buf: [], depth } while in `flywheel repl`
  let replWorker = null, replPending = null;
  const PS = `<span class="u">guest</span><span class="at">@</span><span class="u" style="color:var(--fg)">flywheel</span> <span class="d">~/playground</span> <span class="s">❯</span>`;
  const ps1Html = () => `<span class="ps1">${repl ? (repl.buf.length ? '<span class="fw">...</span>' : '<span class="fw">fw&gt;</span>') : PS}</span>`;
  const setPs1 = () => { ps1.innerHTML = repl ? (repl.buf.length ? '<span class="fw">...</span>' : '<span class="fw">fw&gt;</span>') : PS; };
  const scroll = () => { body.scrollTop = body.scrollHeight; };
  const line = html => { out.insertAdjacentHTML("beforeend", `<div class="ln">${html}</div>`); trim(); scroll(); };
  const text = s => line(esc(s));
  const err = s => line(`<span class="o-err">${esc(s)}</span>`);
  function trim() { while (out.childElementCount > 1500) out.firstElementChild.remove(); }

  const open = (url, newTab = true) => {
    line(`<span class="o-dim">→ opening</span> <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`);
    if (!newTab) { setTimeout(() => location.href = url, 300); return; }
    const w = window.open(url, "_blank", "noopener");
    if (!w && w !== null) return;
  };
  const exampleNames = examples.map(x => x.name);
  const COMMANDS = [
    { name: "help", desc: "list commands", run() {
        line(`<span class="o-dim">commands:</span>`);
        COMMANDS.filter(c => !c.hidden).forEach(c => line(`  <span class="o-acc">${esc((c.name + (c.alias ? ", " + c.alias.join(", ") : "")).padEnd(16))}</span><span class="o-dim">${esc(c.desc)}</span>`));
        line(`<span class="o-dim">Ctrl+Enter runs the editor · Tab completes · ↑↓ history · Ctrl+L clears · Ctrl+C stops</span>`);
    } },
    { name: "run", desc: "run the program in the editor", run() { runProgram(); } },
    { name: "flywheel", alias: ["fw"], desc: "flywheel run | check | repl | --version", args: ["run", "check", "repl", "--version", "help"], run(a) {
        const sub = a[0];
        if (!sub || sub === "help" || sub === "--help") {
          line(`usage: flywheel <command> [file]`);
          line(`  <span class="o-acc">run</span> [file]   <span class="o-dim">compile and run (here: the editor, or an example)</span>`);
          line(`  <span class="o-acc">check</span> [file] <span class="o-dim">parse without running</span>`);
          line(`  <span class="o-acc">repl</span>         <span class="o-dim">interactive session</span>`);
          line(`<span class="o-dim">the real compiler also has build, desktop, serve, test, fmt, doc and lsp — </span><a href="#" data-install>install it</a>`);
          return;
        }
        if (sub === "--version" || sub === "version") return text("flywheel 2.9 (beta-9) — flywheel.js, in your browser");
        if (sub === "repl") return startRepl();
        if (sub === "run" || sub === "check") {
          let code = ed.value;
          if (a[1] && a[1] !== fileName.textContent) {
            const x = examples.find(e => e.name === a[1] || e.id === a[1]);
            if (!x) return err(`flywheel: no such file: ${a[1]}`);
            code = x.code;
          }
          if (sub === "run") return runProgram(code);
          try { Flywheel.parse(code); line(`<span class="o-ok">✓</span> <span class="o-dim">${esc(a[1] || fileName.textContent)} parses</span>`); }
          catch (e) { if (e instanceof Flywheel.CompileError) err(`${a[1] || fileName.textContent}:${e.line}:${e.col}: error: ${e.message}`); else throw e; }
          return;
        }
        err(`flywheel: '${sub}' isn't available in the playground (try run, check or repl)`);
    } },
    { name: "repl", desc: "start an interactive Flywheel session", run() { startRepl(); } },
    { name: "ls", alias: ["examples"], desc: "list example files", run() {
        line(examples.map(x => `<span class="${x.app ? "o-vio" : "o-cyan"}">${esc(x.name)}</span>`).join("  "));
        line(`<span class="o-dim">open &lt;file&gt; loads one · </span><span class="o-vio">purple</span><span class="o-dim"> ones are apps</span>`);
    } },
    { name: "open", alias: ["edit"], desc: "load an example into the editor", args: exampleNames, run(a) {
        if (!a[0]) return err("open: missing file (try ls)");
        if (!loadExample(a[0].replace(/\.fw$/, ""))) err(`open: no such file: ${a[0]}`);
        else line(`<span class="o-dim">loaded ${esc(fileName.textContent)} — Ctrl+Enter to run</span>`);
    } },
    { name: "cat", desc: "print an example's source", args: exampleNames, run(a) {
        const x = a[0] ? examples.find(e => e.name === a[0] || e.id === a[0]) : null;
        if (!a[0]) return line(hlCode(ed.value));
        if (!x) return err(`cat: no such file: ${a[0]}`);
        line(hlCode(x.code.trimEnd()));
    } },
    { name: "learn", desc: "open the lessons", args: LESSONS.map(l => l.id), run(a) { go("#/learn" + (a[0] ? "/" + lessonId(a[0]) : "")); } },
    { name: "docs", alias: ["man"], desc: "open the documentation", args: DOCS.map(d => d.id), run(a) { go("#/docs" + (a[0] ? "/" + a[0] : "")); } },
    { name: "install", desc: "open the install menu (flavors: flywheel / lite / flywheel.js)", args: ["flywheel", "lite", "js", "sh", "ps1"], run(a) {
        if (a[0] === "flywheel-lite" || a[0] === "fwl") a = ["lite"];
        const os = a[0] === "ps1" ? "windows" : a[0] === "sh" ? "linux" : OS;
        const it = INSTALL[os];
        if (a[0] === "js" || a[0] === "flywheel.js") { line(`<span class="o-dim">in your browser it is already here; in Node:</span>`); line(`  <span class="o-cyan">${esc(JS_INSTALL.npx)}</span>`); }
        else if (a[0] === "lite") { line(`<span class="o-dim">run this ${LITE_INSTALL[OS].run}:</span>`); line(`  <span class="o-acc">${esc(LITE_INSTALL[OS].cmd)}</span>`); }
        else {
          line(`<span class="o-dim">run this ${it.run}:</span>`);
          line(`  <span class="o-acc">${esc(it.cmd)}</span>`);
        }
        openInstall(undefined, a[0] === "lite" ? "lite" : a[0] === "js" || a[0] === "flywheel.js" ? "js" : "flywheel");
    } },
    { name: "github", alias: ["gh"], desc: "Flywheel on GitHub", args: ["flywheel", "pulley", "vscode-flywheel"], run(a) {
        open("https://github.com/fwlang/" + (a[0] || "flywheel"));
    } },
    { name: "share", desc: "copy a link to the editor's program", run() { $("#shareBtn").click(); } },
    { name: "stop", desc: "stop the running program", run() { if (!stopProgram("stopped")) line(`<span class="o-dim">nothing is running</span>`); } },
    { name: "cd", desc: "cd .. goes back to polymorphia.dev", args: ["..", "~"], run(a) {
        if (a[0] === ".." || a[0] === "polymorphia" || a[0] === "/") { line(`<span class="o-dim">→ polymorphia.dev</span>`); return setTimeout(goPolymorphia, 200); }
        if (!a[0] || a[0] === "~" || a[0] === ".") return;
        err(`cd: no such directory: ${a[0]}`);
    } },
    { name: "contact", desc: "write to " + EMAIL, run() { line(`<span class="o-dim">→ opening your mail client for</span> <a href="mailto:${EMAIL}">${EMAIL}</a>`); location.href = "mailto:" + EMAIL; } },
    { name: "email", desc: "print the email address", run() { line(`<a href="mailto:${EMAIL}">${EMAIL}</a>`); } },
    { name: "reload", desc: "reload the page", run() { line(`<span class="o-dim">reloading…</span>`); setTimeout(() => location.reload(), 200); } },
    { name: "clear", desc: "clear the screen", run() { out.innerHTML = ""; } },
    { name: "history", desc: "command history", run() { hist.forEach((h, i) => line(`<span class="o-dim">${String(i + 1).padStart(4)}</span>  ${hlCmd(h)}`)); } },
    { name: "echo", desc: "print text", run(a, raw) { text(raw.replace(/^\s*\S+\s?/, "").replace(/^(["'])(.*)\1$/, "$2")); } },
    { name: "whoami", desc: "who are you", run() { text("guest"); } },
    { name: "date", desc: "print the date", run() { text(new Date().toString()); } },
    { name: "exit", hidden: true, desc: "", run() { line(`<span class="o-dim">→ polymorphia.dev</span>`); setTimeout(goPolymorphia, 200); } },
    { name: "sudo", hidden: true, desc: "", run() { err("guest is not in the sudoers file. This incident will be reported."); } },
  ];
  const resolve = n => COMMANDS.find(c => c.name === n || (c.alias && c.alias.includes(n)));
  const NAMES = COMMANDS.filter(c => !c.hidden).flatMap(c => [c.name, ...(c.alias || [])]);

  function hlCmd(str) {
    if (repl) return hlCode(str);
    let html = "", idx = 0, cmd = null;
    for (const part of str.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { html += part; continue; }
      let cls;
      if (idx === 0) { cmd = resolve(part); cls = cmd ? "k-cmd" : NAMES.some(n => n.startsWith(part)) ? "k-pre" : "k-bad"; }
      else if (part.startsWith("-")) cls = "k-flag";
      else if (/^["']/.test(part)) cls = "k-str";
      else cls = "k-arg";
      html += `<span class="${cls}">${esc(part)}</span>`;
      idx++;
    }
    return html;
  }
  function completions(v) {
    if (repl) return [];
    let m;
    if ((m = v.match(/^(\S+)$/))) return NAMES.filter(n => n.startsWith(m[1])).map(n => ({ value: n, label: n, desc: resolve(n).name !== n ? "→ " + resolve(n).name : resolve(n).desc }));
    if ((m = v.match(/^(\S+)(\s+)(\S*)$/))) {
      const c = resolve(m[1]);
      if (!c || !c.args) return [];
      return c.args.filter(a => a.startsWith(m[3])).map(a => ({ value: m[1] + m[2] + a, label: a, desc: "" }));
    }
    if ((m = v.match(/^(flywheel|fw)(\s+)(run|check)(\s+)(\S*)$/))) return exampleNames.filter(a => a.startsWith(m[5])).map(a => ({ value: `${m[1]} ${m[3]} ${a}`, label: a, desc: "" }));
    return [];
  }
  function render() {
    const v = input.value, atEnd = input.selectionStart === v.length;
    const top = items[sel >= 0 ? sel : 0];
    const ghost = !menuOff && atEnd && top && top.value.startsWith(v) && top.value !== v ? top.value.slice(v.length) : "";
    hl.innerHTML = hlCmd(v) + (ghost ? `<span class="ghost">${esc(ghost)}</span>` : "");
    hl.scrollLeft = input.scrollLeft;
    const show = !menuOff && items.length > 1 || (items.length === 1 && !menuOff && items[0].value !== v && sel >= 0);
    menu.innerHTML = show ? items.slice(0, 24).map((it, i) => `<div class="it${i === sel ? " sel" : ""}" data-i="${i}"><span class="nm">${esc(it.label)}</span>${it.desc ? `<span class="ds">${esc(it.desc)}</span>` : ""}</div>`).join("") : "";
    scroll();
  }
  function refresh() { items = completions(input.value); sel = -1; render(); }
  const setValue = v => { input.value = v; input.setSelectionRange(v.length, v.length); };

  /* ---------- REPL */
  function startRepl() {
    repl = { buf: [] };
    line(`<span class="o-vio">Flywheel 2.9 (beta-9) playground repl</span> <span class="o-dim">— statements and expressions; an expression on its own is printed.</span>`);
    line(`<span class="o-dim">:show lists the session, :reset clears it, :quit (or Ctrl+D) leaves</span>`);
    replLog = [];
    setPs1(); render();
  }
  let replLog = [];
  function stopRepl() { repl = null; setPs1(); render(); }
  function replDepth(lines) {
    let d = 0;
    for (const l of lines) {
      const t = l.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/#.*$/, "");
      if (/^\s*end\b/.test(t)) d--;
      else if (/^\s*(?:(?:private|public)\s+)?(?:function\b(?!.*=>)|class\b|interface\b|enum\b|elements\b|match\b|try\s*$)/.test(t) || /\b(?:then|do)\s*$/.test(t) && !/^\s*(?:else|case)\b/.test(t)) d++;
      if (/\bfunction\s*\([^)]*\)(?:\s*returns\s+[\w<>\[\]?, ]+)?\s*$/.test(t) && !/^\s*function\b/.test(t)) d++;
    }
    return d;
  }
  function replSubmit(v) {
    if (!repl.buf.length) {
      if (v.trim() === ":quit" || v.trim() === ":q") { stopRepl(); return; }
      if (v.trim() === ":reset") { replLog = []; if (replWorker) replWorker.postMessage({ type: "repl-reset" }); line(`<span class="o-dim">session cleared</span>`); return; }
      if (v.trim() === ":show") { line(replLog.length ? hlCode(replLog.join("\n")) : `<span class="o-dim">(empty session)</span>`); return; }
      if (!v.trim()) return;
    }
    repl.buf.push(v);
    if (replDepth(repl.buf) > 0) { setPs1(); return; }
    const code = repl.buf.join("\n");
    repl.buf = []; setPs1();
    replLog.push(code);
    if (!replWorker) { replWorker = new Worker("js/worker.js"); replWorker.onmessage = onRepl; }
    const id = ++seq;
    replPending = { id, timer: setTimeout(() => { replWorker.terminate(); replWorker = null; replPending = null; err("■ stopped after 6 s — the session was reset"); replLog = []; }, TIMEOUT) };
    replWorker.postMessage({ type: "repl", id, code });
  }
  function onRepl(e) {
    const m = e.data;
    if (m.type === "out") { for (const l of m.lines) l.err ? err(l.s) : text(l.s); return; }
    if (m.type === "done" && replPending && m.id === replPending.id) { clearTimeout(replPending.timer); replPending = null; }
  }

  /* ---------- input handling */
  function submit(raw) {
    line(`${ps1Html()} ${hlCmd(raw)}`);
    if (repl) { replSubmit(raw); return; }
    const v = raw.trim();
    if (!v) return;
    if (hist[hist.length - 1] !== v) { hist.push(v); if (hist.length > 200) hist.shift(); store.set("fw.hist", JSON.stringify(hist)); }
    hIdx = hist.length;
    const [name, ...args] = v.split(/\s+/);
    const c = resolve(name);
    if (!c) {
      const near = NAMES.find(n => n.startsWith(name.slice(0, 2)));
      return line(`<span class="o-err">pmsh: command not found: ${esc(name)}</span>${near ? ` <span class="o-dim">— did you mean <span class="o-acc">${near}</span>?</span>` : ""}`);
    }
    try { c.run(args, v); } catch (e) { err(String(e && e.message || e)); }
  }
  input.addEventListener("input", () => { menuOff = false; refresh(); });
  input.addEventListener("keydown", e => {
    const showing = menu.childElementCount > 0;
    if (e.key === "Enter") {
      e.preventDefault();
      const v = input.value; setValue(""); menuOff = false; items = []; sel = -1;
      submit(v); render();
    } else if (e.key === "Tab") {
      if (!input.value || repl) { if (repl) { e.preventDefault(); const s = input.selectionStart; input.setRangeText("    ", s, input.selectionEnd, "end"); render(); } return; }
      e.preventDefault();
      if (!items.length) return;
      if (items.length === 1 || (sel < 0 && items.every(i => i.value.startsWith(items[0].value)))) {
        const c = resolve(items[0].value);
        setValue(items[0].value + (c && c.args && !items[0].value.includes(" ") ? " " : "")); menuOff = false; refresh();
      } else { sel = (sel + (e.shiftKey ? -1 : 1) + items.length) % items.length; setValue(items[sel].value); render(); }
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      if (showing && sel >= -1 && items.length > 1) { sel = sel < 0 ? (dir > 0 ? 0 : items.length - 1) : (sel + dir + items.length) % items.length; setValue(items[sel].value); render(); }
      else if (hist.length && !repl) {
        if (hIdx === hist.length) draft = input.value;
        hIdx = clamp(hIdx + dir, 0, hist.length);
        setValue(hIdx === hist.length ? draft : hist[hIdx]);
        menuOff = true; items = []; render();
      }
    } else if (e.key === "ArrowRight" && input.selectionStart === input.value.length) {
      const top = items[sel >= 0 ? sel : 0];
      if (top && !menuOff && top.value.startsWith(input.value) && top.value !== input.value) { e.preventDefault(); setValue(top.value); refresh(); }
    } else if (e.key === "Escape") { menuOff = true; render(); }
    else if (e.ctrlKey && e.key.toLowerCase() === "l") { e.preventDefault(); out.innerHTML = ""; render(); }
    else if (e.ctrlKey && e.key.toLowerCase() === "d" && !input.value) { e.preventDefault(); if (repl) { line(`${ps1Html()} <span class="o-dim">^D</span>`); stopRepl(); } }
    else if (e.ctrlKey && e.key.toLowerCase() === "c" && input.selectionStart === input.selectionEnd) {
      e.preventDefault();
      line(`${ps1Html()} ${hlCmd(input.value)}<span class="o-dim">^C</span>`);
      setValue(""); if (repl) { repl.buf = []; setPs1(); }
      if (pending) stopProgram("stopped (^C)");
      refresh();
    }
  });
  ["keyup", "click", "select"].forEach(ev => input.addEventListener(ev, () => { hl.scrollLeft = input.scrollLeft; }));
  menu.addEventListener("mousedown", e => {
    const it = e.target.closest(".it"); if (!it) return;
    e.preventDefault();
    const v = items[+it.dataset.i].value, c = resolve(v);
    setValue(v + (c && c.args && !v.includes(" ") ? " " : "")); input.focus(); refresh();
  });
  body.addEventListener("mouseup", () => { if (!getSelection().toString()) input.focus({ preventScroll: true }); });
  out.addEventListener("click", e => { const a = e.target.closest("[data-install]"); if (a) { e.preventDefault(); openInstall(); } });
  $("#termClear").addEventListener("click", () => { out.innerHTML = ""; input.focus(); });

  setPs1();
  line(`<span class="o-acc">pmsh 1.0</span> <span class="o-dim">— the polymorphia shell, flywheel edition</span>`);
  line(`<span class="o-dim">try </span><span class="o-acc">help</span><span class="o-dim">, </span><span class="o-acc">ls</span><span class="o-dim">, </span><span class="o-acc">flywheel repl</span><span class="o-dim">, or press Ctrl+Enter in the editor</span>`);
  return { line, text, err, ps1Html, run: submit, input };
})();

/* ================================================================ lessons */
const lessonId = a => { const n = parseInt(a, 10); if (n >= 1 && n <= LESSONS.length) return LESSONS[n - 1].id; const l = LESSONS.find(x => x.id === a || x.id.slice(3) === a); return l ? l.id : LESSONS[0].id; };
const mdCache = new Map();
async function getMd(path) {
  if (!mdCache.has(path)) mdCache.set(path, fetch(path).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }));
  return mdCache.get(path);
}
let lessonCodes = [], docCodes = [], currentLesson = null, currentDoc = null;
const lessonBody = $("#lessonBody");
async function showLesson(id) {
  id = lessonId(id);
  const idx = LESSONS.findIndex(l => l.id === id), L = LESSONS[idx];
  currentLesson = id;
  $("#lessonTitle").textContent = L.title;
  $("#lessonStep").textContent = `${idx + 1} / ${LESSONS.length}`;
  let md;
  try { md = await getMd(`learn/${id}.md`); } catch (e) { lessonBody.innerHTML = `<p class="o-err">Could not load this lesson.</p>`; return; }
  if (currentLesson !== id) return;
  lessonCodes = [];
  const { html } = FwMarkdown.render(md, { codes: lessonCodes, tryLabel: "Load ▶", link: docLink });
  const list = `<details${idx === 0 ? " open" : ""}><summary class="o-dim" style="cursor:pointer;margin-bottom:8px">All lessons</summary><ol class="lesson-list">${LESSONS.map(l => `<li><a href="#/learn/${l.id}"${l.id === id ? ' aria-current="page"' : ""}>${esc(l.title)}</a></li>`).join("")}</ol></details>`;
  const nav = `<div class="lesson-nav">${idx > 0 ? `<a class="btn" href="#/learn/${LESSONS[idx - 1].id}">← ${esc(LESSONS[idx - 1].title)}</a>` : "<span></span>"}${idx < LESSONS.length - 1 ? `<a class="btn acc" href="#/learn/${LESSONS[idx + 1].id}">${esc(LESSONS[idx + 1].title)} →</a>` : `<a class="btn acc" href="#/docs">Read the docs →</a>`}</div>`;
  lessonBody.innerHTML = list + html + nav;
  lessonBody.scrollTop = 0;
  // the lesson's first program goes in the editor (your edits to it are kept per lesson)
  editorOwner = "lesson:" + id;
  const saved = store.get("fw.lesson:" + id, null);
  edSet(saved !== null ? saved : (lessonCodes[0] || ""), `lesson${idx + 1}.fw`);
}
lessonBody.addEventListener("click", e => {
  const b = e.target.closest(".try"); if (!b) return;
  edSet(lessonCodes[+b.dataset.code], fileName.textContent); saveCode(); runProgram();
});

/* ================================================================ docs */
const docSide = $("#docSide"), docEl = $("#doc"), docScroll = $("#docScroll");
{
  let html = "", group = "";
  for (const d of DOCS) {
    if (d.group !== group) { group = d.group; html += `<h4>${esc(group)}</h4>`; }
    html += `<a href="#/docs/${d.id}" data-doc="${d.id}">${esc(d.title)}</a>`;
  }
  html += `<p class="src">The language docs come from <a href="https://github.com/fwlang/flywheel/tree/main/docs" target="_blank" rel="noopener">fwlang/flywheel</a>. Code samples run in the playground.</p>`;
  docSide.innerHTML = html;
}
function docLink(href) {
  if (/^(https?:|mailto:)/.test(href)) return href;
  const [path, anchor] = href.split("#");
  if (!path) return `#/docs/${currentDoc || "overview"}${anchor ? "/" + anchor : ""}`;
  const base = path.split("/").pop().replace(/\.md$/, "");
  if (/pulley/.test(path)) return "https://github.com/fwlang/pulley";
  let id = base;
  if (base === "README") id = /stdlib/.test(path) ? "library" : "overview";
  if (!DOCS.some(d => d.id === id)) return "https://github.com/fwlang/flywheel/blob/main/" + path.replace(/^(\.\.\/)+/, "");
  return `#/docs/${id}${anchor ? "/" + anchor : ""}`;
}
async function showDoc(id, anchor) {
  if (!DOCS.some(d => d.id === id)) id = "overview";
  const changed = currentDoc !== id;
  currentDoc = id;
  $$("[data-doc]", docSide).forEach(a => a.toggleAttribute("aria-current", a.dataset.doc === id));
  $$("[data-doc]", docSide).forEach(a => a.getAttribute("aria-current") !== null && a.setAttribute("aria-current", "page"));
  if (changed || !docEl.innerHTML) {
    let md;
    try { md = await getMd(`docs/${id}.md`); } catch (e) { docEl.innerHTML = `<p class="o-err">Could not load this page.</p>`; return; }
    if (currentDoc !== id) return;
    docCodes = [];
    docEl.innerHTML = FwMarkdown.render(md, { codes: docCodes, link: docLink }).html;
    document.title = `${DOCS.find(d => d.id === id).title} · Flywheel docs`;
  }
  const target = anchor && document.getElementById(anchor);
  if (target) target.scrollIntoView({ block: "start" }); else if (changed) docScroll.scrollTop = 0;
}
docEl.addEventListener("click", e => {
  const b = e.target.closest(".try"); if (!b) return;
  const code = docCodes[+b.dataset.code];
  go("#/");
  edSet(code, "snippet.fw"); saveCode(); runProgram();
});
function rerenderProse() {
  if (currentDoc && document.body.classList.contains("view-docs")) { const id = currentDoc; currentDoc = null; showDoc(id); }
  if (currentLesson && document.body.classList.contains("view-learn")) { const st = lessonBody.scrollTop; showLesson(currentLesson).then(() => { lessonBody.scrollTop = st; }); }
}

/* ================================================================ install */
const dlg = $("#installDlg"), ipanel = $("#ipanel"), idetail = $("#idetail");
let pick = "flywheel", dlgOs = OS, closing = null;
const THEME_NAME = { flywheel: "flywheel", lite: "flywheel lite", js: "flywheel.js" };
const PICKS = ["flywheel", "lite", "js"];
const osTabs = table => `<div class="os-tabs" role="group" aria-label="Operating system">${Object.entries(table).map(([k, v]) => `<button type="button" data-os="${k}" aria-pressed="${k === dlgOs}">${v.label}${k === OS ? '<span class="me">you</span>' : ""}</button>`).join("")}</div>`;
const rawScript = it => method("Raw script", `download ${it.file}, read it, then run it yourself`,
  `<div class="irow"><a class="btn ibtn" href="${it.url}" download="${it.file}">↓ Download ${it.file}</a><a class="btn" href="${it.url}" target="_blank" rel="noopener">View ${it.file} ↗</a></div>
   <p class="inote">${it.kind === "ps1" ? `Run it with <code>powershell -ExecutionPolicy Bypass -File .\\${it.file}</code>.` : `Run it with <code>bash ${it.file}</code> (<code>--help</code> lists the options).`}</p>`);
const cmdBox = (cmd, id) => `<div class="cmdline"><code>${esc(cmd)}</code><button class="btn" type="button" data-copy="${esc(id)}">Copy</button></div>`;
const COPY = {};
const method = (title, sub, body, rec) => `<div class="method"><div class="mh"><b>${title}</b><span>${sub}</span>${rec ? '<span class="rec" style="flex:none">recommended</span>' : ""}</div>${body}</div>`;
function paintInstall() {
  ipanel.dataset.theme = pick;
  $("#iName").textContent = THEME_NAME[pick];
  $$(".icard").forEach(c => c.setAttribute("aria-checked", c.dataset.pick === pick));
  Object.keys(COPY).forEach(k => delete COPY[k]);
  let html;
  if (pick === "flywheel") {
    const it = INSTALL[dlgOs];
    COPY.one = it.cmd; COPY.all = it.all; COPY.src = it.src.replace(/\\n/g, "\n");
    const methods = `<div class="methods">
        ${method("One-line installer", it.kind === "ps1" ? "PowerShell" : "bash", cmdBox(it.cmd, "one"), true)}
        ${rawScript(it)}
        ${method("Everything", "Flywheel + Pulley (packages) + the VS Code extension", cmdBox(it.all, "all"))}
        ${method("From source", "CMake 3.24+, a C++20 compiler, LLVM 21–23", cmdBox(it.src.replace(/\\n/g, "\n"), "src"))}
      </div>`;
    const body = methods + `<p class="inote">${esc(it.note)}</p>`;
    html = `<h3>Install <em>flywheel</em></h3><p>Run ${it.run}. Nothing is installed system-wide except build dependencies, which are listed and confirmed first.</p>
      ${osTabs(INSTALL)}
      ${body}`;
  } else if (pick === "lite") {
    const it = LITE_INSTALL[dlgOs];
    COPY.one = it.cmd; COPY.src = it.src;
    html = `<h3>Install <em>flywheel lite</em></h3><p>Run ${it.run}. It builds Flywheel Lite from source in a few seconds and adds <code>flywheel-lite</code> and its short alias <code>fwl</code> to your PATH; the only dependency is a C compiler.</p>
      ${osTabs(LITE_INSTALL)}
      <div class="methods">
        ${method("One-line installer", it.kind === "ps1" ? "PowerShell" : "bash", cmdBox(it.cmd, "one"), true)}
        ${rawScript(it)}
        ${method("From source", "any C11 compiler; the build embeds library modules from a Flywheel checkout", cmdBox(it.src, "src"))}
      </div>
      <p class="inote">${esc(it.note)}</p>
      <p class="inote">Run programs with <code>flywheel-lite hello.fw</code> or the short alias <code>fwl hello.fw</code>; start a session with <code>fwl repl</code>. Native executables, static type checking, networking, databases, threads and native imports need the compiler; switch to <b style="color:#d4ff3a">flywheel</b> above for those.</p>`;
  } else {
    COPY.tag = JS_INSTALL.tag; COPY.npx = JS_INSTALL.npx; COPY.npm = JS_INSTALL.npm;
    html = `<h3>Use <em>flywheel.js</em></h3><p>It is already running on this page. Nothing to install for the browser; one file for everything else.</p>
      <div class="methods">
        ${method("In your browser", "this page is the playground", `<div class="irow"><button class="btn ibtn" type="button" id="jsPlay">▶ Open the playground</button><a class="btn" href="#/learn" id="jsLearn">Start the tutorial</a></div>`, true)}
        ${method("Script tag", "add it to any web page", cmdBox(JS_INSTALL.tag, "tag"))}
        ${method("Download the file", "dependency-free, MIT licensed", `<div class="irow"><a class="btn ibtn" href="${JS_INSTALL.file}" download="flywheel.js">↓ Download flywheel.js</a><a class="btn" href="https://github.com/fwlang/flywheel.js" target="_blank" rel="noopener">GitHub ↗</a></div>`)}
        ${method("Node command line", "run, check, export, debug, serve, repl", cmdBox(JS_INSTALL.npx, "npx") + `<p class="inote">Or add it to a project: <code>${esc(JS_INSTALL.npm)}</code></p>`)}
      </div>
      <p class="inote">Static type checking, files, networking, databases and native imports need the real compiler; switch to <b style="color:#d4ff3a">flywheel</b> above for those.</p>`;
  }
  idetail.innerHTML = `<div class="iview">${html}</div>`;
}
function openInstall(from, initial) {
  if (closing) { clearTimeout(closing); closing = null; dlg.classList.remove("out"); }
  pick = PICKS.includes(initial) ? initial : "flywheel"; dlgOs = OS; paintInstall();
  if (!dlg.open) dlg.showModal();
  // the panel opens as a circle that grows out of the button that was pressed
  const r = ipanel.getBoundingClientRect(), b = (from || $("#installBtn")).getBoundingClientRect();
  ipanel.style.setProperty("--ox", Math.round(b.left + b.width / 2 - r.left) + "px");
  ipanel.style.setProperty("--oy", Math.round(b.top + b.height / 2 - r.top) + "px");
  // radius that reaches the farthest corner of the whole panel (including scrolled-off content), plus slack
  const ox = b.left + b.width / 2 - r.left, oy = b.top + b.height / 2 - r.top, h = Math.max(r.height, ipanel.scrollHeight);
  ipanel.style.setProperty("--r", Math.ceil(Math.hypot(Math.max(Math.abs(ox), Math.abs(r.width - ox)), Math.max(Math.abs(oy), Math.abs(h - oy))) + 120) + "px");
  dlg.classList.remove("in", "done"); void dlg.offsetWidth;
  requestAnimationFrame(() => dlg.classList.add("in"));
  // fallback in case transitionend never fires (reduced motion, interrupted transition)
  setTimeout(() => { if (dlg.open && dlg.classList.contains("in")) dlg.classList.add("done"); }, reduced ? 50 : 1100);
}
function closeInstall() {
  if (!dlg.open || closing) return;
  // clip-path can't animate from `none`, so put the full circle back before shrinking it
  dlg.classList.remove("done"); void dlg.offsetWidth;
  dlg.classList.remove("in"); dlg.classList.add("out");
  closing = setTimeout(() => { closing = null; dlg.classList.remove("out"); dlg.close(); }, reduced ? 10 : 420);
}
function choose(p) {
  if (p === pick) return;
  pick = p; paintInstall();
  const l = $("#iLogo"); l.classList.remove("spin"); void l.offsetWidth; l.classList.add("spin");
}
dlg.addEventListener("click", e => {
  const t = e.target;
  if (t === dlg) return closeInstall();
  const card = t.closest(".icard"); if (card) return choose(card.dataset.pick);
  const osb = t.closest("[data-os]"); if (osb) { dlgOs = osb.dataset.os; paintInstall(); return; }
  const cp = t.closest("[data-copy]");
  if (cp) {
    const txt = COPY[cp.dataset.copy];
    navigator.clipboard.writeText(txt).then(() => { cp.textContent = "Copied"; setTimeout(() => cp.textContent = "Copy", 1400); },
      () => getSelection().selectAllChildren(cp.previousElementSibling));
    return;
  }
  if (t.closest("#jsPlay")) { closeInstall(); go("#/"); return; }
  if (t.closest("#jsLearn")) { closeInstall(); }
});
ipanel.addEventListener("transitionend", e => { if (e.target === ipanel && e.propertyName === "clip-path" && dlg.classList.contains("in")) dlg.classList.add("done"); });
dlg.addEventListener("cancel", e => { e.preventDefault(); closeInstall(); });
$("#installClose").addEventListener("click", closeInstall);
// arrow keys move between the three flavors, like a radio group
$(".ichoice").addEventListener("keydown", e => {
  const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!dir) return;
  e.preventDefault(); const p = PICKS[(PICKS.indexOf(pick) + dir + PICKS.length) % PICKS.length]; choose(p); $(`.icard[data-pick="${p}"]`).focus();
});
// the Install button opens the menu; nothing is downloaded until you choose to
$("#installBtn").addEventListener("click", () => openInstall());

/* ================================================================ routing */
const tabs = $$("nav.tabs a");
function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }
function setView(v) {
  document.body.classList.remove("view-play", "view-learn", "view-docs");
  document.body.classList.add("view-" + v);
  tabs.forEach(a => a.toggleAttribute("aria-current", a.dataset.view === v));
  tabs.forEach(a => a.hasAttribute("aria-current") && a.setAttribute("aria-current", "page"));
  if (v !== "docs") document.title = v === "learn" ? "Learn · Flywheel" : "Flywheel playground";
}
function showPlay() {
  setView("play");
  if (editorOwner !== "play") {
    editorOwner = "play";
    edSet(store.get("fw.play", null) ?? examples[0].code, store.get("fw.playName", null) || examples[0].name);
  }
}
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "learn") { setView("learn"); showLesson(parts[1] || LESSONS[0].id); }
  else if (parts[0] === "docs") { setView("docs"); showDoc(parts[1] || "overview", parts[2]); }
  else if (parts[0] === "p" && parts[1]) {
    let code = null;
    try { code = b64d(parts[1]); } catch (e) { toast("That share link is damaged"); }
    history.replaceState(null, "", location.pathname + "#/");
    setView("play"); editorOwner = "play";
    if (code !== null) { edSet(code, "shared.fw"); saveCode(); toast("Loaded a shared program — Ctrl+Enter runs it"); }
  } else showPlay();
}
addEventListener("hashchange", route);

/* ================================================================ start */
editorOwner = "boot";
route();
if (editorOwner === "boot") showPlay();
edCaret();
grammarReady.then(() => edRender());
})();
