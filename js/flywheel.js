/* flywheel.js — the Flywheel language in JavaScript.
 * https://github.com/fwlang/flywheel.js · MIT licence
 *
 * The real Flywheel compiler (github.com/fwlang/flywheel) is C++ on LLVM and produces native
 * executables, so it cannot run in a browser. flywheel.js is a tree-walking interpreter for the
 * language that mirrors the compiler's semantics and output formatting closely enough for
 * learning and prototyping: classes, interfaces, inheritance, enums with data, exhaustive-style
 * match, generics (erased), nullable values, closures, format specs, collections, Results,
 * exceptions, defer, markup with components, and a browser-safe subset of the standard library.
 *
 * Static typing is not checked here; programs that the compiler would reject may still run.
 *
 * Works in a window, a Web Worker or Node: exposes `Flywheel` on the global object and as the
 * CommonJS export.
 */
(function (root) {
"use strict";

/* =========================================================================================
 * errors and control signals
 * ========================================================================================= */
class FwError { constructor(type, message) { this.type = type; this.message = message; } get name() { return this.type; } }
class FwThrow { constructor(value) { this.value = value; } }          // a Flywheel exception in flight
class CompileError extends Error {
  constructor(msg, line, col) { super(msg); this.line = line; this.col = col; }
}
class ReturnSig { constructor(v) { this.v = v; } }
class BreakSig {}
class ContinueSig {}
const BREAK = new BreakSig(), CONTINUE = new ContinueSig();
const fail = (type, msg) => { throw new FwThrow(new FwError(type, msg)); };
const ERROR_TYPES = ["Error", "RuntimeError", "FileError", "InputError", "ProcessError", "IndexError", "KeyError",
  "NumericError", "AssertionError", "JsonError", "ResultError", "CastError", "SelectorError", "ValueError",
  "RegexError", "NetworkError", "HttpError", "DatabaseError", "DesktopError", "NativeError"];

/* =========================================================================================
 * lexer
 * ========================================================================================= */
const KEYWORDS = new Set(("if then else while do for in end break continue return try catch finally throw and or not " +
  "var const function returns class component interface enum extends implements match case import as is inst " +
  "attr super null true false defer private public readonly elements which").split(" "));
const OPS = ["..<", "//=", "..", "//", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "=>", "??",
  "+", "-", "*", "/", "%", "<", ">", "=", "(", ")", "[", "]", "{", "}", ",", ".", ":", ";", "?", "\\"];
// a line ending in one of these continues onto the next line
const CONTINUES = new Set(["+", "-", "*", "/", "//", "%", "==", "!=", "<=", ">=", "and", "or", "??", "..", "..<",
  "=", "+=", "-=", "*=", "/=", "//=", "%=", "=>", ",", "\\", "not"]);
const VOID_TAGS = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const BOOL_ATTRS = new Set(("allowfullscreen async autofocus autoplay checked controls default defer disabled " +
  "formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly " +
  "required reversed selected").split(" "));
const isIdStart = c => /[A-Za-z_À-￿]/.test(c);
const isIdChar = c => /[A-Za-z0-9_À-￿]/.test(c);
const isTagStart = c => /[A-Za-z_]/.test(c);
const isTagChar = c => /[A-Za-z0-9_.:\-]/.test(c);

class Source {
  constructor(text, name) {
    this.text = text; this.name = name || "main.fw";
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") this.lineStarts.push(i + 1);
  }
  pos(off) {
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.lineStarts[mid] <= off) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: off - this.lineStarts[lo] + 1 };
  }
  err(msg, off) { const p = this.pos(off); return new CompileError(msg, p.line, p.col); }
}

// Tokenize from `start`. With `stop` set, stops before a depth-0 "}" (or ":" when stop === "spec")
// and returns the position it stopped at; used for markup and interpolation expressions.
function tokenize(S, start, stop) {
  const src = S.text, toks = [];
  let i = start, depth = 0, spaceBefore = false;
  const last = () => toks[toks.length - 1];
  const push = (t, v, s, e) => { toks.push({ t, v, s, e, sp: spaceBefore }); spaceBefore = false; };
  const valueEnd = tk => tk && (tk.t === "num" || tk.t === "str" || tk.t === "char" || tk.t === "markup" ||
    tk.t === "json" || (tk.t === "id" && tk.v !== "print") || (tk.t === "kw" && /^(true|false|null)$/.test(tk.v)) ||
    (tk.t === "op" && /^[)\]}]$/.test(tk.v)));
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r") { i++; spaceBefore = true; continue; }
    if (c === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "\n") {
      const lt = last();
      if (stop) { i++; spaceBefore = true; continue; }
      if (lt && lt.t !== "nl") {
        const v = lt.t === "op" || lt.t === "kw" ? lt.v : null;
        const starAfterDot = v === "*" && toks.length > 1 && toks[toks.length - 2].v === ".";
        if (v === "\\") { toks.pop(); }
        else if (!(v && CONTINUES.has(v) && !starAfterDot)) push("nl", "\n", i, i + 1);
      }
      i++; spaceBefore = true; continue;
    }
    if (stop && depth === 0 && (c === "}" || (stop === "spec" && c === ":"))) return { toks, end: i };
    // <json>...</json>: raw JSON, checked now
    if (c === "<" && src.startsWith("<json>", i) && !valueEnd(last())) {
      const e = src.indexOf("</json>", i + 6);
      if (e < 0) throw S.err("unterminated <json> literal", i);
      let v;
      try { v = JSON.parse(src.slice(i + 6, e)); } catch (err) { throw S.err("invalid JSON in <json> literal: " + err.message, i); }
      push("json", v, i, e + 7); i = e + 7; continue;
    }
    // markup
    if (c === "<" && (isTagStart(src[i + 1] || "") || src[i + 1] === ">") && !valueEnd(last())) {
      const m = lexMarkup(S, i);
      push("markup", m.node, i, m.end); i = m.end; continue;
    }
    if (isIdStart(c)) {
      let j = i + 1; while (j < src.length && isIdChar(src[j])) j++;
      const w = src.slice(i, j);
      push(KEYWORDS.has(w) ? "kw" : "id", w, i, j); i = j; continue;
    }
    if (/[0-9]/.test(c)) {
      const j = lexNumber(S, i);
      push("num", parseNumber(S, src.slice(i, j), i), i, j); i = j;
      // a quantity literal: a unit right after the number, 100m, 0.32km (15time.s is a member)
      if (isIdStart(src[i] || "")) {
        let k = i + 1; while (k < src.length && isIdChar(src[k])) k++;
        const w = src.slice(i, k);
        if (!KEYWORDS.has(w) && !/^(returns|with)$/.test(w)) { last().unit = w; last().e = k; i = k; }
      }
      continue;
    }
    if (c === '"') { const r = lexString(S, i, '"'); push("str", r.parts, i, r.end); i = r.end; continue; }
    if (c === "'") { const r = lexChar(S, i); push("char", r.v, i, r.end); i = r.end; continue; }
    let op = null;
    for (const o of OPS) if (src.startsWith(o, i)) { op = o; break; }
    if (!op) throw S.err(`unexpected character '${c}'`, i);
    if (op === "(" || op === "[" || op === "{") depth++;
    if (op === ")" || op === "]" || op === "}") depth--;
    push("op", op, i, i + op.length); i += op.length;
  }
  if (stop) throw S.err("unterminated expression", start);
  push("nl", "\n", i, i); push("eof", "", i, i);
  return { toks, end: i };
}

function lexNumber(S, i) {
  const src = S.text; let j = i;
  if (src[j] === "0" && /[xXbBoO]/.test(src[j + 1] || "")) { j += 2; while (/[0-9a-fA-F_]/.test(src[j] || "")) j++; return j; }
  while (/[0-9_]/.test(src[j] || "")) j++;
  if (src[j] === "." && /[0-9]/.test(src[j + 1] || "")) { j++; while (/[0-9_]/.test(src[j] || "")) j++; }
  if (/[eE]/.test(src[j] || "") && /[0-9+\-]/.test(src[j + 1] || "")) {
    let k = j + 1; if (/[+\-]/.test(src[k])) k++;
    if (/[0-9]/.test(src[k] || "")) { j = k; while (/[0-9]/.test(src[j] || "")) j++; }
  }
  return j;
}
function parseNumber(S, text, off) {
  const t = text.replace(/_/g, "");
  if (/^0[xXbBoO]/.test(t)) return BigInt(t);
  if (/[.eE]/.test(t)) return { d: Number(t) };
  const v = BigInt(t);
  if (v > 18446744073709551615n) throw S.err("integer literal too large", off);
  return v;
}

function readEscape(S, i) {         // at backslash; returns [text, next]
  const src = S.text, n = src[i + 1];
  const map = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'", "0": "\0", "{": "{", "}": "}" };
  if (n === "u" && src[i + 2] === "{") {
    const j = src.indexOf("}", i + 3);
    return [String.fromCodePoint(parseInt(src.slice(i + 3, j), 16)), j + 1];
  }
  if (n in map) return [map[n], i + 2];
  throw S.err(`invalid escape '\\${n}'`, i);
}

// A string literal with interpolation. Returns parts: strings and {toks, spec, off} expressions.
function lexString(S, i, quote, markup) {
  const src = S.text, parts = []; let buf = "", j = i + 1;
  for (;;) {
    if (j >= src.length || (src[j] === "\n" && !markup)) throw S.err("unterminated string", i);
    const c = src[j];
    if (c === quote) { j++; break; }
    if (c === "\\" && !markup) { const [t, n] = readEscape(S, j); buf += t; j = n; continue; }
    if (c === "&" && markup) { const [t, n] = readEntity(S, j); buf += t; j = n; continue; }
    if (c === "{" && src[j + 1] === "{") { buf += "{"; j += 2; continue; }
    if (c === "}" && src[j + 1] === "}") { buf += "}"; j += 2; continue; }
    if (c === "{" && !/[\s]/.test(src[j + 1] || " ")) {
      let r;
      try { r = interpolation(S, j); }
      catch (e) { if (!(e instanceof CompileError)) throw e; buf += c; j++; continue; }
      if (buf) parts.push(buf); buf = "";
      parts.push(r.part); j = r.end; continue;
    }
    buf += c; j++;
  }
  if (buf || !parts.length) parts.push(buf);
  return { parts, end: j };
}
function interpolation(S, j) {     // at "{"
  const r = tokenize(S, j + 1, "spec");
  let spec = null, end = r.end;
  if (S.text[end] === ":") {
    const close = S.text.indexOf("}", end);
    if (close < 0) throw S.err("unterminated interpolation", j);
    spec = S.text.slice(end + 1, close); end = close;
  }
  if (!r.toks.length) throw S.err("empty interpolation", j);
  r.toks.push({ t: "eof", v: "", s: end, e: end });
  return { part: { toks: r.toks, spec, off: j }, end: end + 1 };
}
function lexChar(S, i) {
  const src = S.text; let j = i + 1, v;
  if (src[j] === "\\") { const [t, n] = readEscape(S, j); v = t; j = n; }
  else { const cp = src.codePointAt(j); v = String.fromCodePoint(cp); j += v.length; }
  if (src[j] !== "'") throw S.err("unterminated char literal", i);
  return { v: new FwChar(v.codePointAt(0)), end: j + 1 };
}
function readEntity(S, j) {
  const m = /^&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/.exec(S.text.slice(j, j + 12));
  if (!m) throw S.err("markup '&' must begin an entity (use &amp;)", j);
  const e = m[1], named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const t = e in named ? named[e] : String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return [t, j + m[0].length];
}

// Markup: <tag attrs>children</tag>, <tag/>, <>fragment</>. Expressions become token lists.
function lexMarkup(S, i) {
  const src = S.text, s0 = i;
  if (src[i + 1] === ">") {
    const r = lexChildren(S, i + 2, "");
    return { node: { k: "El", tag: "", attrs: [], children: r.children, off: s0 }, end: r.end };
  }
  let j = i + 1; while (j < src.length && isTagChar(src[j])) j++;
  const tag = src.slice(i + 1, j), attrs = [];
  for (;;) {
    while (/\s/.test(src[j] || "")) j++;
    if (j >= src.length) throw S.err(`unterminated <${tag}>`, s0);
    if (src.startsWith("/>", j)) { return { node: { k: "El", tag, attrs, children: [], off: s0 }, end: j + 2 }; }
    if (src[j] === ">") { j++; break; }
    if (src[j] === "{") {   // {expr} spread is not supported; treat as error
      throw S.err("expected attribute name", j);
    }
    let k = j; while (k < src.length && /[A-Za-z0-9_.:@\-]/.test(src[k])) k++;
    if (k === j) throw S.err(`unexpected '${src[j]}' in <${tag}>`, j);
    const name = src.slice(j, k); j = k;
    let p = j; while (/[ \t]/.test(src[p] || "")) p++;
    if (src[p] === "=" && src[p + 1] !== "=") {
      p++; while (/[ \t]/.test(src[p] || "")) p++;
      if (src[p] === '"' || src[p] === "'") {
        const r = lexString(S, p, src[p], true);
        attrs.push({ name, v: { k: "Parts", parts: r.parts } }); j = r.end;
      } else if (src[p] === "{") {
        const r = tokenize(S, p + 1, true);
        r.toks.push({ t: "eof", v: "", s: r.end, e: r.end });
        attrs.push({ name, v: { k: "Toks", toks: r.toks, off: p } }); j = r.end + 1;
      } else {
        let q = p; while (q < src.length && !/[\s"'<>=`{}]/.test(src[q]) && !src.startsWith("/>", q)) q++;
        attrs.push({ name, v: { k: "Parts", parts: [src.slice(p, q)] } }); j = q;
      }
    } else attrs.push({ name, v: null });
  }
  if (VOID_TAGS.has(tag)) return { node: { k: "El", tag, attrs, children: [], off: s0 }, end: j };
  const r = lexChildren(S, j, tag, tag === "style" || tag === "script");
  return { node: { k: "El", tag, attrs, children: r.children, off: s0 }, end: r.end };
}
function lexChildren(S, j, tag, raw) {
  const src = S.text, children = []; let buf = "";
  const flush = () => {
    if (buf && !(/^\s*$/.test(buf) && buf.includes("\n"))) children.push({ k: "Text", v: buf });
    buf = "";
  };
  for (;;) {
    if (j >= src.length) throw S.err(tag ? `missing </${tag}>` : "missing </>", j);
    if (src.startsWith("</", j)) {
      let k = j + 2; while (isTagChar(src[k] || "")) k++;
      const name = src.slice(j + 2, k);
      if (!raw || name === tag) {
        let q = k; while (/\s/.test(src[q] || "")) q++;
        if (src[q] !== ">") throw S.err("expected '>'", q);
        if (name !== tag) throw S.err(tag ? `expected </${tag}>, got </${name}>` : `expected </>, got </${name}>`, j);
        flush(); return { children, end: q + 1 };
      }
    }
    const c = src[j];
    if (!raw && src.startsWith("<!--", j)) { const e = src.indexOf("-->", j); j = e < 0 ? src.length : e + 3; continue; }
    if (!raw && c === "<" && (isTagStart(src[j + 1] || "") || src[j + 1] === ">")) {
      flush(); const m = lexMarkup(S, j); children.push(m.node); j = m.end; continue;
    }
    if (c === "{" && src[j + 1] === "{") { buf += "{"; j += 2; continue; }
    if (c === "}" && src[j + 1] === "}") { buf += "}"; j += 2; continue; }
    if (c === "{" && !/\s/.test(src[j + 1] || " ")) {
      flush();
      const r = tokenize(S, j + 1, true);
      r.toks.push({ t: "eof", v: "", s: r.end, e: r.end });
      children.push({ k: "Toks", toks: r.toks, off: j }); j = r.end + 1; continue;
    }
    if (c === "&" && !raw) { const [t, n] = readEntity(S, j); buf += t; j = n; continue; }
    buf += c; j++;
  }
}

/* =========================================================================================
 * parser
 * ========================================================================================= */
const BIN = {
  "or": 1, "and": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "in": 4, "is": 4,
  "??": 5, "..": 6, "..<": 6, "+": 7, "-": 7, "*": 8, "/": 8, "//": 8, "%": 8, "as": 9,
};
const UNIT_NUMBERS = new Set("int float double i8 i16 i32 i64 u8 u16 u32 u64 f32 f64".split(" "));
const PRIM_TYPES = new Set("int float double string bool char void element fragment i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 any".split(" "));
const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "//=", "%="]);

class Parser {
  constructor(S, toks, nl) { this.S = S; this.toks = toks; this.p = 0; this.skipNL = nl ? 0 : 1; }
  idx(o) {
    let i = this.p, n = o || 0;
    for (;;) {
      const t = this.toks[i];
      if (!t) return this.toks.length - 1;
      if (t.t === "nl" && this.skipNL > 0) { i++; continue; }
      if (n === 0) return i;
      n--; i++;
    }
  }
  peek(o) { return this.toks[this.idx(o)]; }
  next() { const i = this.idx(0); this.p = i + 1; return this.toks[i]; }
  is(t, v, o) { const k = this.peek(o); return k.t === t && (v === undefined || k.v === v); }
  op(v, o) { return this.is("op", v, o); }
  kw(v, o) { return this.is("kw", v, o); }
  accept(t, v) { if (this.is(t, v)) return this.next(); return null; }
  err(msg, tk) { tk = tk || this.peek(); return this.S.err(msg, tk.s); }
  desc(tk) { return tk.t === "nl" ? "end of line" : tk.t === "eof" ? "end of file" : tk.t === "markup" ? "markup" : tk.t === "str" ? "string" : `'${tk.v}'`; }
  expect(t, v) {
    const tk = this.peek();
    if (tk.t === t && (v === undefined || tk.v === v)) return this.next();
    throw this.err(`expected ${v !== undefined ? `'${v}'` : t === "id" ? "a name" : t}, got ${this.desc(tk)}`, tk);
  }
  name() {
    const tk = this.peek();
    if (tk.t === "id") return this.next().v;
    throw this.err(`expected a name, got ${this.desc(tk)}`, tk);
  }
  line(tk) { return this.S.pos((tk || this.peek()).s).line; }
  eol() { return this.is("nl") || this.is("eof") || this.op(";"); }
  eol1() { const t = this.peek(1); return t.t === "nl" || t.t === "eof" || (t.t === "op" && t.v === ";"); }
  endStmt() {
    if (this.op(";")) { this.next(); return; }
    if (this.is("nl")) { this.next(); return; }
    if (this.is("eof") || this.kw("end") || this.kw("else") || this.kw("catch") || this.kw("finally") || this.kw("then") || this.kw("case")) return;
    throw this.err(`expected end of statement, got ${this.desc(this.peek())}`);
  }
  withNL(n, f) { const s = this.skipNL; this.skipNL = n; try { return f(); } finally { this.skipNL = s; } }

  /* ---------------- program / blocks */
  program() {
    const body = this.block(["eof"]);
    return body;
  }
  block(enders) {
    const out = [];
    for (;;) {
      while (this.is("nl") || this.op(";")) this.next();
      const tk = this.peek();
      if (tk.t === "eof" && !enders.includes("eof")) throw this.err("expected 'end', got end of file");
      if ((tk.t === "kw" || tk.t === "eof") && enders.includes(tk.t === "eof" ? "eof" : tk.v)) return out;
      out.push(this.statement());
    }
  }

  /* ---------------- types */
  tryType() {
    const save = this.p;
    try { const t = this.type(); return t; } catch (e) { if (e instanceof CompileError && !e.fatal) { this.p = save; return null; } throw e; }
  }
  type() {
    let t;
    const tk = this.peek();
    if (tk.t === "kw" && tk.v === "function" && this.op("(", 1)) {
      this.next(); this.next();
      const params = [];
      this.withNL(1, () => {
        while (!this.op(")")) { params.push(this.type()); if (!this.accept("op", ",")) break; }
        this.expect("op", ")");
      });
      this.expect("kw", "returns");
      return { fn: { params, ret: this.type() } };     // suffixes belong to the return type
    } else if (this.op("(")) {
      this.next(); t = this.type(); this.expect("op", ")");
    } else if (this.op("[")) {
      this.next(); const items = [];
      while (!this.op("]")) { items.push(this.type()); if (!this.accept("op", ",")) break; }
      this.expect("op", "]");
      t = { tuple: items };
    } else if (tk.t === "id") {
      let name = this.next().v;
      while (this.op(".") && this.is("id", undefined, 1)) { this.next(); name += "." + this.next().v; }
      t = { name };
      if (this.op("<") && !this.peek().sp) t.args = this.typeArgs();
      // int[time], u8[time], float[metric.length]: a number in a unit namespace
      if (PRIM_TYPES.has(name) && this.op("[") && this.is("id", undefined, 1) &&
          (this.op("]", 2) || (this.op(".", 2) && this.is("id", undefined, 3) && this.op("]", 4)))) {
        this.next();
        let module = null, ns = this.name();
        if (this.accept("op", ".")) { module = ns; ns = this.name(); }
        this.next();
        if (!UNIT_NUMBERS.has(name)) {
          const e = this.err(`units apply only to numbers: ${name}[${ns}] is not a type; use a numeric type such as int[${ns}] or float[${ns}]`, tk);
          e.fatal = true;
          throw e;
        }
        t.unit = { ns, module, real: name === "float" || name === "double" || name === "f32" || name === "f64" };
      }
    } else throw this.err("expected a type");
    for (;;) {
      if (this.op("[") && this.op("]", 1) && !this.peek().sp) { this.next(); this.next(); t = { arr: t }; continue; }
      if (this.op("?") && !this.peek().sp) { this.next(); t = { opt: t }; continue; }
      break;
    }
    return t;
  }
  typeArgs() {
    this.expect("op", "<"); const args = [];
    for (;;) { args.push(this.type()); if (!this.accept("op", ",")) break; }
    this.expect("op", ">");
    return args;
  }
  skipTypeParams() {        // <T, U is comparable, V implements X>
    if (!(this.op("<") && !this.peek().sp)) return [];
    this.next(); const names = []; let depth = 1;
    while (depth > 0) {
      const tk = this.next();
      if (tk.t === "eof") throw this.err("unterminated type parameters");
      if (tk.v === "<") depth++; else if (tk.v === ">") depth--;
      else if (tk.t === "id" && depth === 1 && (names.length === 0 || this.toks[this.p - 2].v === ",")) names.push(tk.v);
    }
    return names;
  }
  typeLike(t) { return t.fn || t.tuple || t.arr || t.opt || t.args || t.unit || PRIM_TYPES.has(t.name) || /^[A-Z]/.test(t.name.split(".").pop()); }

  /* ---------------- statements */
  statement() {
    const tk = this.peek(), line = this.line(tk);
    const st = this.statementInner();
    if (st) st.line = st.line || line;
    return st;
  }
  statementInner() {
    const tk = this.peek();
    if (tk.t === "kw") {
      switch (tk.v) {
        case "private": case "public": this.next(); return this.statementInner();
        case "import": return this.importStmt();
        case "function":
          if (this.is("id", undefined, 1)) return this.funcDecl();
          break;
        case "class": return this.classDecl();
        case "interface": return this.ifaceDecl();
        case "enum": return this.enumDecl();
        case "component": return this.compDecl();
        case "elements": { this.next(); while (!this.kw("end")) { if (this.is("eof")) throw this.err("expected 'end'"); this.next(); } this.next(); return { k: "Nop" }; }
        case "var": case "const": return this.varDecl();
        case "if": return this.ifStmt();
        case "while": return this.whileStmt();
        case "for": return this.forStmt();
        case "match": return this.matchStmt();
        case "try": return this.tryStmt();
        case "return": {
          this.next();
          const value = this.eol() || this.kw("end") ? null : this.outerExpr();
          this.endStmt(); return { k: "Return", value };
        }
        case "break": this.next(); this.endStmt(); return { k: "Break" };
        case "continue": this.next(); this.endStmt(); return { k: "Continue" };
        case "throw": {
          this.next();
          const value = this.expr();
          // throw "Name" "message"  (a comma between the two is optional)
          if (!this.eol() && !this.kw("end") && (value.k === "Lit" || value.k === "Str")) {
            this.accept("op", ",");
            const msg = this.expr();
            if (value.k !== "Lit" || typeof value.v !== "string" || !(msg.k === "Lit" && typeof msg.v === "string" || msg.k === "Str"))
              throw this.err("throw with a name expects two strings");
            this.endStmt(); return { k: "Throw", name: value.v, value: msg };
          }
          this.endStmt(); return { k: "Throw", value };
        }
        case "defer": {
          this.next();
          if (this.is("nl")) { this.next(); const body = this.block(["end"]); this.expect("kw", "end"); this.endStmt(); return { k: "Defer", body }; }
          const st = this.statement(); return { k: "Defer", body: [st] };
        }
      }
    }
    if (tk.t === "id" && tk.v === "unitns" && this.is("id", undefined, 1)) {
      const t2 = this.peek(2);
      if (t2.t === "nl" || t2.t === "eof" || (t2.t === "op" && t2.v === ";") || (t2.t === "kw" && t2.v === "for")) {
        this.next(); const name = this.name();
        if (this.kw("for")) throw this.err(`unitns takes only a name: write \`unitns ${name}\`; units apply to every numeric type`);
        this.endStmt(); return { k: "UnitNs", name };
      }
    }
    if (tk.t === "id" && tk.v === "unit" && this.is("id", undefined, 1) && this.op(".", 2) && this.is("id", undefined, 3) && this.op("=", 4)) {
      this.next(); const ns = this.name(); this.next(); const unit = this.name(); this.next();
      const number = () => {
        const n = this.next();
        if (n.t !== "num" || n.unit) throw this.err("a unit's factor is a positive number, such as unit time.min = 60 or unit time.ms = 1/1000", n);
        return this.S.text.slice(n.s, n.e).replace(/_/g, "");
      };
      let factor = number();
      if (this.accept("op", "/")) factor += "/" + number();
      this.endStmt(); return { k: "UnitDecl", ns, unit, factor };
    }
    if (tk.t === "id" && tk.v === "unitconv" && this.is("num", undefined, 1)) {
      this.next();
      const quantity = () => {
        const n = this.next();
        if (n.t !== "num" || !n.unit || !this.op(".") || !this.is("id", undefined, 1))
          throw this.err("unitconv relates quantities, such as unitconv 1metric_length.m / 1time.s = 1metric_speed.mps", n);
        this.next();
        let ns = n.unit, unit = this.name();
        // 0.3048metric.length.m: a namespace of an imported module
        if (this.op(".") && this.is("id", undefined, 1)) { this.next(); ns += "." + unit; unit = this.name(); }
        return { amount: Number(typeof n.v === "object" ? n.v.d : n.v), ns, unit };
      };
      const a = quantity();
      if (this.accept("op", "=")) {       // unitconv 1length.ft = 0.3048metric.length.m
        const b = quantity();
        this.endStmt(); return { k: "UnitConv", a, op: "=", b, line: this.line(tk) };
      }
      if (!this.op("*") && !this.op("/")) throw this.err("unitconv expects * or /, or = to relate two namespaces that measure the same thing");
      const op = this.next().v, b = quantity();
      this.expect("op", "=");
      const c = quantity();
      this.endStmt(); return { k: "UnitConv", a, op, b, c, line: this.line(tk) };
    }
    if (tk.t === "id" && tk.v === "assert" && !this.is("op", "=", 1) && !this.is("op", ".", 1) && !this.eol1()) return this.assertStmt();
    // typed declaration: Type name [= value]
    if (tk.t === "id" || this.op("(") || this.op("[") || (tk.t === "kw" && tk.v === "function")) {
      const save = this.p;
      const t = this.tryType();
      if (t && this.is("id")) {
        const nameTk = this.peek();
        const after = this.peek(1);
        const hasInit = after.t === "op" && after.v === "=";
        const bare = after.t === "nl" || after.t === "eof" || (after.t === "op" && after.v === ";");
        if (hasInit || (bare && this.typeLike(t))) {
          this.next();
          let value = null;
          if (hasInit) { this.next(); value = this.outerExpr(); }
          this.endStmt();
          return { k: "Var", name: nameTk.v, type: t, value, line: this.line(nameTk) };
        }
      }
      this.p = save;
    }
    return this.exprStatement();
  }
  importStmt() {
    const itk = this.next();
    // native imports: import c name / cxx / import++ / rust / zig
    let lang = null;
    if (this.op("+") && this.op("+", 1) && !this.peek().sp) { this.next(); this.next(); lang = "cxx"; }
    else if (this.is("id") && /^(c|cxx|rust|zig)$/.test(this.peek().v) && (this.is("id", undefined, 1) || this.is("str", undefined, 1))) lang = this.next().v;
    if (lang) {
      let path;
      if (this.is("str")) path = this.strPlain(this.next());
      else { path = this.name(); while (this.accept("op", ".")) path += "." + this.name(); }
      let alias = null; if (this.accept("kw", "as")) alias = this.name();
      this.endStmt();
      return { k: "Import", path, alias, native: lang };
    }
    // string imports: a module name, a file path, or a URL
    if (this.is("str")) {
      const spec = this.strPlain(this.next());
      let alias = null; if (this.accept("kw", "as")) alias = this.name();
      this.endStmt();
      const isFile = /^[a-z][a-z0-9+.-]*:\/\//i.test(spec) || /[\/\\]/.test(spec) || /\.(fw|fly)$/.test(spec);
      if (!isFile) return { k: "Import", path: spec, wildcard: false, alias };
      const base = spec.split(/[\/\\]/).pop().replace(/\.(fw|fly)$/, "");
      if (!alias && !/^[A-Za-z_]\w*$/.test(base)) throw this.S.err(`'${base}' is not a valid module name; add \`as name\``, itk.s);
      return { k: "Import", path: spec, alias: alias || base, file: true };
    }
    let path = this.name(), wildcard = false, alias = null;
    while (this.accept("op", ".")) { if (this.accept("op", "*")) { wildcard = true; break; } path += "." + this.name(); }
    if (this.accept("kw", "as")) alias = this.name();
    this.endStmt();
    return { k: "Import", path, wildcard, alias };
  }
  strPlain(tk) {
    if (!(tk.v.length === 1 && typeof tk.v[0] === "string") && tk.v.length !== 0) throw this.err("expected a plain string", tk);
    return tk.v.length ? tk.v[0] : "";
  }
  params() {
    const params = [];
    if (!this.op("(")) return params;
    this.next();
    this.withNL(1, () => {
      while (!this.op(")")) {
        const type = this.type(), name = this.name();
        let def = null;
        if (this.accept("op", "=")) def = this.expr();
        params.push({ name, type, def });
        if (!this.accept("op", ",")) break;
      }
      this.expect("op", ")");
    });
    return params;
  }
  funcHeader() {
    const kwTk = this.expect("kw", "function");
    let name = this.name();
    if (name === "operator") {
      if (this.op("[")) { this.next(); this.expect("op", "]"); name = "operator []"; if (this.op("=") && !this.peek().sp) { this.next(); name += "="; } }
      else { const o = this.next(); name = "operator " + o.v; }
    }
    const tparams = this.skipTypeParams();
    const params = this.params();
    let ret = null;
    if (this.accept("kw", "returns")) ret = this.type();
    return { name, params, ret, tparams, line: this.line(kwTk) };
  }
  funcDecl() {
    const h = this.funcHeader();
    if (this.accept("op", "=>")) { const e = this.expr(); this.endStmt(); return { k: "Func", ...h, body: [{ k: "Return", value: e, line: h.line }] }; }
    this.expect("nl");
    const body = this.block(["end"]); this.expect("kw", "end"); this.endStmt();
    return { k: "Func", ...h, body };
  }
  classDecl() {
    this.next();
    const name = this.name(), tparams = this.skipTypeParams();
    let base = null; const ifaces = [];
    if (this.accept("kw", "extends")) base = this.type().name;
    if (this.accept("kw", "implements")) { do ifaces.push(this.type().name); while (this.accept("op", ",")); }
    this.expect("nl");
    const fields = [], methods = [];
    for (;;) {
      while (this.is("nl") || this.op(";")) this.next();
      if (this.kw("end")) break;
      if (this.is("eof")) throw this.err(`expected 'end' to close class ${name}`);
      const mods = new Set();
      while (this.kw("private") || this.kw("readonly") || this.kw("public")) mods.add(this.next().v);
      if (this.kw("function")) { const m = this.funcDecl(); m.mods = mods; methods.push(m); continue; }
      const ftk = this.peek();
      const type = this.type(), fname = this.name();
      let def = null;
      if (this.accept("op", "=")) def = this.expr();
      this.endStmt();
      fields.push({ name: fname, type, def, mods, line: this.line(ftk) });
    }
    this.expect("kw", "end"); this.endStmt();
    return { k: "Class", name, tparams, base, ifaces, fields, methods };
  }
  ifaceDecl() {
    this.next();
    const name = this.name(); this.skipTypeParams();
    const bases = [];
    if (this.accept("kw", "extends")) { do bases.push(this.type().name); while (this.accept("op", ",")); }
    this.expect("nl");
    const sigs = [];
    for (;;) {
      while (this.is("nl")) this.next();
      if (this.kw("end")) break;
      if (this.is("eof")) throw this.err(`expected 'end' to close interface ${name}`);
      sigs.push(this.funcHeader().name); this.endStmt();
    }
    this.expect("kw", "end"); this.endStmt();
    return { k: "Interface", name, bases, sigs };
  }
  enumDecl() {
    this.next();
    const name = this.name(); this.expect("nl");
    const members = [];
    for (;;) {
      while (this.is("nl") || this.op(",")) this.next();
      if (this.kw("end")) break;
      if (this.is("eof")) throw this.err(`expected 'end' to close enum ${name}`);
      const m = this.name();
      const fields = this.op("(") ? this.params() : null;
      members.push({ name: m, fields });
    }
    this.expect("kw", "end"); this.endStmt();
    return { k: "Enum", name, members };
  }
  compDecl() {
    this.next(); const name = this.name(); this.expect("op", "=");
    const tk = this.expect("markup");
    this.endStmt();
    return { k: "Component", name, node: this.markup(tk.v) };
  }
  varDecl() {
    const isConst = this.next().v === "const";
    // destructuring
    if (this.op("(") || this.op("[")) {
      const close = this.next().v === "(" ? ")" : "]";
      const names = [];
      while (!this.op(close)) { names.push(this.name()); if (!this.accept("op", ",")) break; }
      this.expect("op", close); this.expect("op", "=");
      const value = this.outerExpr(); this.endStmt();
      return { k: "Destructure", names, value };
    }
    let type = null;
    if (!(this.is("id") && (this.op("=", 1) || this.is("nl", undefined, 1) || this.is("eof", undefined, 1)))) type = this.type();
    const name = this.name();
    let value = null;
    if (this.accept("op", "=")) value = this.outerExpr();
    else if (!type) throw this.err("expected '=' after variable name");
    this.endStmt();
    return { k: "Var", name, type, value, isConst };
  }
  ifStmt() {
    this.next();
    const branches = [];
    let cond = this.expr(); this.expect("kw", "then");
    let body = this.block(["else", "end"]);
    branches.push({ cond, body });
    let otherwise = null;
    while (this.accept("kw", "else")) {
      if (this.accept("kw", "if")) {
        cond = this.expr(); this.expect("kw", "then");
        branches.push({ cond, body: this.block(["else", "end"]) });
      } else { otherwise = this.block(["end"]); break; }
    }
    this.expect("kw", "end"); this.endStmt();
    return { k: "If", branches, otherwise };
  }
  whileStmt() {
    this.next(); const cond = this.expr(); this.expect("kw", "do");
    const body = this.block(["end"]); this.expect("kw", "end"); this.endStmt();
    return { k: "While", cond, body };
  }
  forStmt() {
    this.next();
    const names = [this.name()];
    if (this.accept("op", ",")) names.push(this.name());
    this.expect("kw", "in");
    const iter = this.expr(); this.expect("kw", "do");
    const body = this.block(["end"]); this.expect("kw", "end"); this.endStmt();
    return { k: "For", names, iter, body };
  }
  matchStmt() {
    this.next(); const subject = this.expr(); this.expect("nl");
    const cases = []; let otherwise = null;
    for (;;) {
      while (this.is("nl")) this.next();
      if (this.accept("kw", "case")) {
        const pats = [];
        do pats.push(this.pattern()); while (this.accept("op", ","));
        let guard = null;
        if (this.accept("kw", "if")) guard = this.expr();
        this.expect("kw", "then");
        cases.push({ pats, guard, body: this.block(["case", "else", "end"]) });
      } else if (this.accept("kw", "else")) { otherwise = this.block(["end"]); }
      else break;
    }
    this.expect("kw", "end"); this.endStmt();
    return { k: "Match", subject, cases, otherwise };
  }
  pattern() {
    const tk = this.peek();
    // ok v / error e
    if (tk.t === "id" && (tk.v === "ok" || tk.v === "error") && this.is("id", undefined, 1)) {
      this.next(); return { p: "Result", ok: tk.v === "ok", bind: this.next().v };
    }
    if (tk.t === "kw" && tk.v === "null") { this.next(); return { p: "Value", e: { k: "Lit", v: null } }; }
    if (tk.t === "op" && tk.v === "[") {
      this.next(); const items = [];
      this.withNL(1, () => { while (!this.op("]")) { items.push(this.subPattern()); if (!this.accept("op", ",")) break; } this.expect("op", "]"); });
      return { p: "Seq", items };
    }
    // Type name binding:  Circle c / int n / Shape.Circle c
    if (tk.t === "id") {
      const save = this.p;
      const t = this.tryType();
      if (t && t.name !== undefined || (t && (t.arr || t.opt))) {
        if (this.is("id") && (this.is("kw", "then", 1) || this.is("kw", "if", 1) || this.op(",", 1))) {
          return { p: "Type", type: t, bind: this.next().v };
        }
      }
      this.p = save;
    }
    const e = this.expr();
    if (e.k === "Call") return { p: "Destructure", callee: e.callee, items: e.args.map(a => this.argToPattern(a)) };
    if (e.k === "Bin" && (e.op === ".." || e.op === "..<")) return { p: "Range", lo: e.l, hi: e.r, incl: e.op === ".." };
    if (e.k === "Ident" || e.k === "Member") return { p: "Name", e };
    return { p: "Value", e };
  }
  subPattern() {
    if (this.op("[")) return this.pattern();
    const e = this.expr();
    return this.argToPattern(e);
  }
  argToPattern(e) {
    if (e.k === "Ident") return e.name === "_" ? { p: "Skip" } : { p: "Bind", name: e.name };
    if (e.k === "Call") return { p: "Destructure", callee: e.callee, items: e.args.map(a => this.argToPattern(a)) };
    if (e.k === "List") return { p: "Seq", items: e.items.map(a => this.argToPattern(a)) };
    return { p: "Value", e };
  }
  assertStmt() {
    this.next();
    let cond, msg = null;
    if (this.op("(") && !this.peek().sp) {          // assert(cond, "message")
      const save = this.p;
      try {
        this.next();
        const items = this.withNL(1, () => { const a = []; while (!this.op(")")) { a.push(this.expr()); if (!this.accept("op", ",")) break; } this.expect("op", ")"); return a; });
        if (this.eol() && items.length >= 1 && items.length <= 2) { cond = items[0]; msg = items[1] || null; }
        else this.p = save;
      } catch (e) { if (!(e instanceof CompileError)) throw e; this.p = save; }
    }
    if (!cond) {
      cond = this.expr();
      if (!this.eol() && !this.kw("end")) { this.accept("op", ","); msg = this.expr(); }
    }
    this.endStmt();
    return { k: "Assert", cond, msg };
  }
  tryStmt() {
    this.next();
    const body = this.block(["catch", "finally", "then", "end"]);
    const catches = []; let fin = null;
    while (this.accept("kw", "catch")) {
      let type = null, name = null;
      if (this.is("str")) {                           // catch "Name" e
        const tk = this.next();
        if (!(tk.v.length === 1 && typeof tk.v[0] === "string")) throw this.err("a catch name must be a plain string", tk);
        type = tk.v[0]; if (this.is("id")) name = this.name();
      }
      else if (this.is("id") && this.is("id", undefined, 1)) { type = this.type().name; name = this.name(); }
      else if (this.is("id")) { const n = this.name(); if (/^[A-Z]/.test(n) && (n === "Error" || ERROR_TYPES.includes(n))) type = n; else name = n; }
      catches.push({ type, name, body: this.block(["catch", "finally", "then", "end"]) });
    }
    if (!catches.length && !this.is("kw", "finally") && !this.is("kw", "then")) throw this.err("try requires catch, finally, or then");
    if (this.accept("kw", "finally") || this.accept("kw", "then")) fin = this.block(["end"]);
    this.expect("kw", "end"); this.endStmt();
    return { k: "Try", body, catches, fin };
  }
  exprStatement() {
    const tk = this.peek();
    const e = this.outerExpr(true);
    if (this.is("op") && ASSIGN_OPS.has(this.peek().v)) {
      const op = this.next().v;
      const value = this.outerExpr();
      if (!/^(Ident|Member|Index|InstField)$/.test(e.k)) throw this.err("invalid assignment target", tk);
      this.endStmt();
      return { k: "Assign", target: e, op, value };
    }
    this.endStmt();
    return { k: "Expr", e };
  }

  /* ---------------- expressions */
  // An expression that may be an outer call without parentheses:  print a, b   /   f x
  outerExpr() {
    const tk = this.peek();
    if (tk.t === "id" || (tk.t === "kw" && (tk.v === "inst" || tk.v === "super"))) {
      const save = this.p;
      let head = this.postfix(this.primary(), true);
      if ((head.k === "Ident" || head.k === "Member" || head.k === "InstField") && this.op("(") && this.peek().sp) {
        const after = this.p;
        try {
          this.next();
          const args = this.withNL(1, () => { const a = []; while (!this.op(")")) { a.push(this.expr()); if (!this.accept("op", ",")) break; } this.expect("op", ")"); return a; });
          const nt = this.peek();
          const continues = this.binOp() || this.op(",") || (nt.t === "op" && /^[.\[(?]$/.test(nt.v)) || nt.t === "str" || nt.t === "id" || nt.t === "num";
          if (!continues) return { k: "Call", callee: head, args, outer: true, line: this.line(tk) };
        } catch (e) { if (!(e instanceof CompileError)) throw e; }
        this.p = after;
      }
      if ((head.k === "Ident" || head.k === "Member" || head.k === "InstField") && this.canStartOuterArg()) {
        const args = [];
        do args.push(this.expr()); while (this.accept("op", ","));
        return { k: "Call", callee: head, args, outer: true, line: this.line(tk) };
      }
      // not an outer call: re-parse normally (spaced ( or [ were left for us)
      this.p = save;
    }
    return this.expr();
  }
  canStartOuterArg() {
    const t = this.peek();
    if (t.t === "nl" || t.t === "eof") return false;
    if (t.t === "num" || t.t === "str" || t.t === "char" || t.t === "markup" || t.t === "json" || t.t === "id") return true;
    if (t.t === "kw") return /^(true|false|null|not|function|inst|attr)$/.test(t.v);
    if (t.t === "op") {
      if ((t.v === "(" || t.v === "[") && t.sp) return true;
      if ((t.v === "-" || t.v === "+") && t.sp && !this.peek(1).sp) return true;
    }
    return false;
  }
  // `items which condition` keeps the items for which the condition holds. It binds looser than every
  // other operator and chains left to right: `xs which > 1 which < 9`.
  expr(minPrec) {
    let e = this.infix(this.unary(), minPrec || 0);
    while (!minPrec && this.peek().t === "kw" && this.peek().v === "which") e = this.which(e);
    return e;
  }
  which(items) {
    const tk = this.next(), line = this.line(tk), at = this.peek();
    if (at.t === "nl" || at.t === "eof" || (at.t === "kw" && at.v === "which"))
      throw this.err("'which' expects a condition, such as 'which .age >= 18' or 'which > 10'", at);
    this.whichDepth = (this.whichDepth || 0) + 1;
    let cond;
    try { cond = this.infix(this.unary(), 0); } finally { this.whichDepth--; }
    const params = [{ name: "$which", type: null, def: null }];
    return { k: "Which", e: items, fn: { k: "Lambda", params, ret: null, body: [{ k: "Return", value: cond, line }], line }, line };
  }
  unary() {
    const tk = this.peek();
    if (this.whichDepth > 0) {
      // inside a `which` condition, `.name` reads a member of the item, and a leading operator compares it
      if (tk.t === "op" && tk.v === "." && this.peek(1).t === "id") return this.postfix({ k: "Ident", name: "$which", line: this.line(tk) });
      if ((tk.t === "op" && ["==", "!=", "<", ">", "<=", ">=", "*", "/", "//", "%"].includes(tk.v)) || (tk.t === "kw" && (tk.v === "in" || tk.v === "is")))
        return { k: "Ident", name: "$which", line: this.line(tk) };
    }
    if (tk.t === "op" && (tk.v === "-" || tk.v === "+")) {
      this.next();
      const operand = this.infix(this.unary(), 9);
      return { k: "Unary", op: tk.v, e: operand, line: this.line(tk) };
    }
    if (tk.t === "kw" && tk.v === "not") { this.next(); return { k: "Not", e: this.expr(2), line: this.line(tk) }; }
    return this.postfix(this.primary());
  }
  binOp() {
    const t = this.peek();
    if (t.t === "op" && t.v in BIN) return t.v;
    if (t.t === "kw" && (t.v === "and" || t.v === "or" || t.v === "in" || t.v === "is" || t.v === "as")) return t.v;
    return null;
  }
  infix(left, minPrec) {
    for (;;) {
      const op = this.binOp();
      if (!op) return left;
      const prec = BIN[op];
      if (prec <= minPrec) return left;
      const tk = this.next(), line = this.line(tk);
      if (op === "is" || op === "as") {
        const type = this.type();
        left = { k: op === "is" ? "Is" : "As", e: left, type, line };
        continue;
      }
      if (prec === 3 || (prec === 4 && op !== "in")) {
        const ops = [op], items = [left, this.expr(prec)];
        while (this.binOp() && BIN[this.binOp()] === prec && this.binOp() !== "in" && this.binOp() !== "is") {
          ops.push(this.next().v); items.push(this.expr(prec));
        }
        left = ops.length === 1 ? { k: "Bin", op, l: items[0], r: items[1], line } : { k: "Chain", ops, items, line };
        continue;
      }
      const right = this.expr(prec);
      left = op === "and" || op === "or" ? { k: "Logic", op, l: left, r: right, line } : { k: "Bin", op, l: left, r: right, line };
    }
  }
  primary() {
    const tk = this.next(), line = this.line(tk);
    switch (tk.t) {
      case "num":
        if (tk.unit) return { k: "Qty", v: typeof tk.v === "object" ? tk.v.d : tk.v, unit: tk.unit, text: this.S.text.slice(tk.s, tk.e), line };
        return { k: "Lit", v: typeof tk.v === "object" ? tk.v.d : tk.v };
      case "str": return this.strNode(tk.v);
      case "char": return { k: "Lit", v: tk.v };
      case "markup": return this.markup(tk.v);
      case "json": return { k: "JsonLit", v: tk.v };
      case "id": return { k: "Ident", name: tk.v, line };
      case "kw":
        switch (tk.v) {
          case "true": return { k: "Lit", v: true };
          case "false": return { k: "Lit", v: false };
          case "null": return { k: "Lit", v: null };
          case "inst": {
            if (this.op("(") && !this.peek().sp) return { k: "Self" };
            if (!this.is("id")) return { k: "Self" };
            return { k: "InstField", name: this.name(), line };
          }
          case "attr": return { k: "Attr", name: this.name(), line };
          case "super": this.expect("op", "."); return { k: "Super", name: this.name(), line };
          case "function": return this.lambda(line);
        }
        break;
      case "op":
        if (tk.v === "(") {
          return this.withNL(1, () => { const e = this.expr(); this.expect("op", ")"); return { k: "Paren", e }; });
        }
        if (tk.v === "[") {
          return this.withNL(1, () => {
            const items = [];
            while (!this.op("]")) { items.push(this.expr()); if (!this.accept("op", ",")) break; }
            this.expect("op", "]");
            return { k: "List", items, line };
          });
        }
        if (tk.v === "{") {
          return this.withNL(1, () => {
            if (this.accept("op", "}")) return { k: "EmptyBraces", line };
            const first = this.expr();
            if (this.accept("op", ":")) {
              const entries = [[first, this.expr()]];
              while (this.accept("op", ",")) { if (this.op("}")) break; const k = this.expr(); this.expect("op", ":"); entries.push([k, this.expr()]); }
              this.expect("op", "}");
              return { k: "MapLit", entries, line };
            }
            const items = [first];
            while (this.accept("op", ",")) { if (this.op("}")) break; items.push(this.expr()); }
            this.expect("op", "}");
            return { k: "SetLit", items, line };
          });
        }
    }
    throw this.err(`expected an expression, got ${this.desc(tk)}`, tk);
  }
  lambda(line) {
    const params = this.params();
    let ret = null;
    if (this.accept("kw", "returns")) ret = this.type();
    if (this.accept("op", "=>")) {
      const e = this.expr();
      return { k: "Lambda", params, ret, body: [{ k: "Return", value: e, line }], line };
    }
    const body = this.withNL(0, () => {
      this.expect("nl");
      const b = this.block(["end"]); this.expect("kw", "end"); return b;
    });
    return { k: "Lambda", params, ret, body, line };
  }
  postfix(e, head) {
    for (;;) {
      const t = this.peek();
      if (t.t !== "op") return e;
      if (t.v === "." ) {
        const n = this.peek(1);
        if (n.t !== "id" && n.t !== "kw") return e;
        this.next(); this.next();
        e = { k: "Member", e, name: n.v, line: this.line(n) };
        continue;
      }
      if (t.v === "(") {
        if (head && t.sp) return e;
        this.next();
        const args = this.withNL(1, () => {
          const a = [];
          while (!this.op(")")) { a.push(this.expr()); if (!this.accept("op", ",")) break; }
          this.expect("op", ")");
          return a;
        });
        e = { k: "Call", callee: e, args, line: this.line(t) };
        continue;
      }
      if (t.v === "[") {
        if (t.sp && (head || e.k === "Lit")) return e;
        this.next();
        const index = this.withNL(1, () => { const i = this.expr(); this.expect("op", "]"); return i; });
        e = { k: "Index", e, index, line: this.line(t) };
        continue;
      }
      if (t.v === "<" && !t.sp && (e.k === "Ident" || e.k === "Member")) {
        const save = this.p;
        try {
          const args = this.typeArgs();
          const n = this.peek();
          if ((n.t === "op" && /^[(),\]}]$/.test(n.v)) || n.t === "nl" || n.t === "eof" || (n.t === "op" && n.v === "." )) {
            e = { k: "TypeApp", e, args, line: this.line(t) };
            continue;
          }
        } catch (err) { if (!(err instanceof CompileError)) throw err; }
        this.p = save;
        return e;
      }
      return e;
    }
  }
  strNode(parts) {
    if (parts.length === 1 && typeof parts[0] === "string") return { k: "Lit", v: parts[0] };
    return { k: "Str", parts: parts.map(p => typeof p === "string" ? p : { e: this.sub(p.toks), spec: p.spec }) };
  }
  sub(toks) {
    const P = new Parser(this.S, toks, false);
    const e = P.expr();
    if (!P.is("eof")) throw P.err(`unexpected ${P.desc(P.peek())}`);
    return e;
  }
  markup(n) {
    if (n.k === "Text") return n;
    if (n.k === "Toks") return { k: "MExpr", e: this.sub(n.toks) };
    const attrs = n.attrs.map(a => ({
      name: a.name,
      v: a.v === null ? null : a.v.k === "Toks" ? this.sub(a.v.toks) : this.strNode(a.v.parts),
    }));
    return { k: "Markup", tag: n.tag, attrs, children: n.children.map(c => this.markup(c)), line: this.S.pos(n.off).line };
  }
}

function parse(text, name) {
  const S = new Source(text, name);
  const { toks } = tokenize(S, 0, false);
  const P = new Parser(S, toks, true);
  return P.program();
}

/* =========================================================================================
 * runtime values
 * ========================================================================================= */
class FwChar { constructor(cp) { this.cp = cp; } toString() { return String.fromCodePoint(this.cp); } }
class Tuple { constructor(items) { this.items = items; } }
class Instance { constructor(cls) { this.cls = cls; this.f = new Map(); } }
class EnumVal { constructor(en, member, fields) { this.en = en; this.member = member; this.fields = fields; } }
class ResultVal { constructor(ok, v) { this.ok = ok; this.v = v; } }
class FwFunc {
  constructor(name, params, body, closure, opts) {
    this.name = name; this.params = params; this.body = body; this.closure = closure;
    this.cls = opts && opts.cls || null; this.isMethod = !!(opts && opts.method);
  }
}
class Bound { constructor(fn, self) { this.fn = fn; this.self = self; } }
class Native { constructor(name, fn) { this.name = name; this.fn = fn; } }
class FwClass {
  constructor(name) { this.name = name; this.base = null; this.ifaces = []; this.fields = []; this.methods = new Map(); this.isInterface = false; this.isEnumMember = false; }
}
class FwEnum { constructor(name) { this.name = name; this.members = []; this.byName = new Map(); } }
class EnumMember { constructor(en, name, index, fields) { this.en = en; this.name = name; this.index = index; this.fields = fields; this.value = null; } }
class Module { constructor(name, members) { this.name = name; this.members = members; } }
class Component { constructor(name, node, scope) { this.name = name; this.node = node; this.scope = scope; } }
class JsonVal { constructor(v) { this.v = v; } }
class Window { constructor(title) { this.title = title; this.tree = null; } }

class FwElement {
  constructor(tag) { this.tag = tag; this.attrs = new Map(); this.children = []; this.parent = null; }
}

class FwMap {
  constructor() { this.m = new Map(); this.frozen = false; }
  get size() { return this.m.size; }
  slot(interp, k, create) {
    if (k instanceof Instance && findMethod(k.cls, "hash")) {
      const h = interp.callMethod(k, "hash", []);
      for (const [sk, ent] of this.m) if (sk.startsWith("h" + h + "#") && interp.eq(ent.k, k)) return sk;
      return create ? "h" + h + "#" + (this.seq = (this.seq || 0) + 1) : null;
    }
    return keyOf(k);
  }
  get(interp, k) { const s = this.slot(interp, k); const ent = s && this.m.get(s); return ent; }
  set(interp, k, v) { if (this.frozen) fail("ValueError", "cannot modify a frozen map"); const s = this.slot(interp, k, true); const ent = this.m.get(s); if (ent) ent.v = v; else this.m.set(s, { k, v }); }
  remove(interp, k) { if (this.frozen) fail("ValueError", "cannot modify a frozen map"); const s = this.slot(interp, k); return s ? this.m.delete(s) : false; }
  has(interp, k) { return !!this.get(interp, k); }
  keys() { return [...this.m.values()].map(e => e.k); }
  values() { return [...this.m.values()].map(e => e.v); }
}
class FwSet {
  constructor() { this.m = new FwMap(); this.frozen = false; }
  get size() { return this.m.size; }
  add(interp, v) { if (this.frozen) fail("ValueError", "cannot modify a frozen set"); if (this.m.has(interp, v)) return false; this.m.set(interp, v, true); return true; }
  has(interp, v) { return this.m.has(interp, v); }
  remove(interp, v) { if (this.frozen) fail("ValueError", "cannot modify a frozen set"); return this.m.remove(interp, v); }
  items() { return this.m.keys(); }
}

function keyOf(v) {
  if (typeof v === "bigint") return "i" + v;
  if (typeof v === "number") return "d" + v;
  if (typeof v === "string") return "s" + v;
  if (typeof v === "boolean") return "b" + v;
  if (v === null) return "n";
  if (v instanceof FwChar) return "c" + v.cp;
  if (v instanceof EnumVal && !v.fields) return "e" + v.en.name + "." + v.member.index;
  if (v instanceof Tuple) return "t[" + v.items.map(keyOf).join(",") + "]";
  if (v instanceof Quantity) return "q" + v.ns.id + ":" + (Number(v.amount) * v.ns.factors[v.unit].value).toPrecision(12);
  if (v instanceof Instance || v instanceof FwElement) { if (!v.__id) v.__id = ++keyOf.seq; return "o" + v.__id; }
  fail("ValueError", "value is not hashable");
}
keyOf.seq = 0;

const I64MIN = -(2n ** 63n), I64MAX = 2n ** 63n - 1n;
const ck = v => { if (v < I64MIN || v > I64MAX) fail("NumericError", "integer overflow"); return v; };
const isNum = v => typeof v === "bigint" || typeof v === "number";
const isSeq = v => Array.isArray(v) || v instanceof Tuple;
const seqItems = v => Array.isArray(v) ? v : v instanceof Tuple ? v.items : null;
const cps = s => Array.from(s);
const strLen = s => { let n = 0; for (const _ of s) n++; return n; };

function findMethod(cls, name) {
  for (let c = cls; c; c = c.base) { const m = c.methods.get(name); if (m) return m; }
  return null;
}
function isSubclass(cls, target) {
  const seen = new Set();
  const walk = c => {
    if (!c || seen.has(c)) return false;
    seen.add(c);
    if (c === target) return true;
    if (walk(c.base)) return true;
    return c.ifaces.some(walk);
  };
  return walk(cls);
}

/* ---------------------------------------------------------------- number formatting */
function fmtG(x, prec) {
  prec = prec || 15;
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x < 0 ? "-inf" : "inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const ex = x.toExponential(prec - 1);
  let [mant, e] = ex.split("e"); const exp = parseInt(e, 10);
  if (exp < -4 || exp >= prec) {
    if (mant.includes(".")) mant = mant.replace(/0+$/, "").replace(/\.$/, "");
    return mant + "e" + (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
  }
  let s = x.toFixed(Math.max(0, prec - 1 - exp));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}
function groupDigits(s, sep, every) {
  const neg = s[0] === "-" ? "-" : ""; if (neg) s = s.slice(1);
  let [int, frac] = s.split(".");
  let out = "";
  while (int.length > every) { out = sep + int.slice(-every) + out; int = int.slice(0, -every); }
  return neg + int + out + (frac !== undefined ? "." + frac : "");
}
function applySpec(interp, v, spec) {
  const m = /^(?:(.)?([<>^=]))?([+\- ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGosxX%])?$/su.exec(spec);
  if (!m) fail("ValueError", `invalid format spec '${spec}'`);
  let [, fill, align, sign, alt, zero, width, group, prec, type] = m;
  if (!align && fill) { align = fill; fill = undefined; }
  width = width ? parseInt(width, 10) : 0;
  prec = prec !== undefined ? parseInt(prec, 10) : null;
  let body, numeric = false, neg = false;
  if (v instanceof EnumVal || v instanceof Instance || v instanceof FwChar || typeof v === "boolean" || v === null) {
    if (v instanceof FwChar && type && type !== "s" && type !== "c") v = BigInt(v.cp);
  }
  if (isNum(v) && type !== "s") {
    numeric = true;
    let x = v;
    const t = type || (typeof x === "bigint" ? "d" : "");
    if ("doxXbc".includes(t) && t) {
      if (typeof x === "number") { if (!Number.isInteger(x)) fail("ValueError", `format '${t}' needs an integer`); x = BigInt(x); }
      if (t === "c") { body = String.fromCodePoint(Number(x)); numeric = false; }
      else {
        neg = x < 0n; if (neg) x = -x;
        const base = { d: 10, o: 8, x: 16, X: 16, b: 2 }[t];
        body = x.toString(base); if (t === "X") body = body.toUpperCase();
        if (group) body = groupDigits(body, group, base === 10 ? 3 : 4);
        if (alt && base !== 10) body = { 8: "0o", 16: t === "X" ? "0X" : "0x", 2: "0b" }[base] + body;
      }
    } else {
      x = Number(x);
      neg = x < 0 || Object.is(x, -0); if (neg) x = -x;
      if (t === "f" || t === "F") body = x.toFixed(prec === null ? 6 : prec);
      else if (t === "e" || t === "E") {
        let s = x.toExponential(prec === null ? 6 : prec);
        s = s.replace(/e([+-])(\d)$/, "e$10$2"); body = t === "E" ? s.toUpperCase() : s;
      } else if (t === "%") body = (x * 100).toFixed(prec === null ? 6 : prec) + "%";
      else if (t === "g" || t === "G") body = fmtG(x, prec === null ? 6 : Math.max(prec, 1));
      else body = prec === null ? (typeof v === "bigint" ? v.toString().replace("-", "") : fmtG(x)) : fmtG(x, Math.max(prec, 1));
      if (group) body = groupDigits(body.replace(/%$/, ""), group, 3) + (body.endsWith("%") ? "%" : "");
    }
    const sg = neg ? "-" : sign === "+" ? "+" : sign === " " ? " " : "";
    if (zero && !align) { fill = "0"; align = "="; }
    if (align === "=") {
      const padN = Math.max(0, width - strLen(sg + body));
      return sg + (fill || " ").repeat(padN) + body;
    }
    body = sg + body;
  } else {
    body = interp.show(v, false);
    if (prec !== null) body = cps(body).slice(0, prec).join("");
  }
  const len = strLen(body);
  if (len >= width) return body;
  const f = fill || " ", n = width - len;
  const a = align || (numeric ? ">" : "<");
  if (a === "<") return body + f.repeat(n);
  if (a === ">") return f.repeat(n) + body;
  const l = Math.floor(n / 2);
  return f.repeat(l) + body + f.repeat(n - l);
}

const escHtml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const escAttr = escHtml;
function escStr(s, q) {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === q) out += "\\" + q;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\r") out += "\\r";
    else if (c < 32 || c === 127) out += "\\u{" + c.toString(16) + "}";
    else out += ch;
  }
  return out;
}

/* =========================================================================================
 * units: `unitns time`, `unit time.min = 60`, `unitconv 1length.m / 1time.s = 1speed.mps`,
 * quantities such as 15s (they keep the unit they were written in), int[time] / float[time]
 * types, and the metric, imperial, and time unit libraries. Units apply to every numeric type;
 * mixing namespaces is checked when the operation runs.
 * ========================================================================================= */
const bgcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
function ratio(num, den) { const g = bgcd(num, den) || 1n; num /= g; den /= g; return { num, den, value: Number(num) / Number(den) }; }
function decimalRatio(text) {
  if (/[eE]/.test(text)) { const x = Number(text); return { num: 0n, den: 0n, value: x, inexact: true }; }
  const [whole, frac = ""] = text.split(".");
  return ratio(BigInt(whole + frac || "0"), 10n ** BigInt(frac.length));
}
function divideRatio(a, b) {
  if (a.inexact || b.inexact) return { value: a.value / b.value, inexact: true };
  return ratio(a.num * b.den, a.den * b.num);
}
class UnitNs {
  constructor(name, module) { this.name = name; this.module = module; this.units = []; this.factors = []; this.id = ++UnitNs.seq; this.visible = true; }
  index(unit) { return this.units.indexOf(unit); }
}
UnitNs.seq = 0;
class Quantity { constructor(ns, amount, unit) { this.ns = ns; this.amount = amount; this.unit = unit; } }
// The unit declarations of the library modules (stdlib/fw/_time.fw, metric.fw, imperial.fw).
const UNIT_LIBRARIES = {
  time: { needs: [], src: `unitns time
unit time.ns = 1/1000000000
unit time.us = 1/1000000
unit time.ms = 1/1000
unit time.s = 1
unit time.min = 60
unit time.h = 3600
unit time.d = 86400
unit time.wk = 604800
` },
  metric: { needs: ["time"], src: `unitns length
unit length.nm = 1/1000000000
unit length.um = 1/1000000
unit length.mm = 1/1000
unit length.cm = 1/100
unit length.dm = 1/10
unit length.m = 1
unit length.km = 1000
unitns area
unit area.mm2 = 1/1000000
unit area.cm2 = 1/10000
unit area.m2 = 1
unit area.ha = 10000
unit area.km2 = 1000000
unitns volume
unit volume.ml = 1/1000
unit volume.cm3 = 1/1000
unit volume.cl = 1/100
unit volume.dl = 1/10
unit volume.l = 1
unit volume.dm3 = 1
unit volume.m3 = 1000
unitns weight
unit weight.mg = 1/1000000
unit weight.g = 1/1000
unit weight.kg = 1
unit weight.t = 1000
unitns speed
unit speed.mps = 1
unit speed.kmph = 5/18
unitconv 1length.m * 1length.m = 1area.m2
unitconv 1area.m2 * 1length.m = 1volume.m3
unitconv 1length.m / 1time.s = 1speed.mps
` },
  imperial: { needs: ["metric", "time"], src: `unitns length
unit length.inch = 1/12
unit length.ft = 1
unit length.yd = 3
unit length.ch = 66
unit length.fur = 660
unit length.mi = 5280
unitns area
unit area.sqin = 1/144
unit area.sqft = 1
unit area.sqyd = 9
unit area.acre = 43560
unit area.sqmi = 27878400
unitns volume
unit volume.floz = 1
unit volume.gi = 5
unit volume.pt = 20
unit volume.qt = 40
unit volume.gal = 160
unit volume.cuin = 16.387064/28.4130625
unit volume.cuft = 28316.846592/28.4130625
unitns weight
unit weight.oz = 1/16
unit weight.lb = 1
unit weight.st = 14
unit weight.cwt = 112
unit weight.ton = 2240
unitns speed
unit speed.fps = 1
unit speed.mph = 22/15
unitconv 1length.ft * 1length.ft = 1area.sqft
unitconv 1area.sqft * 1length.ft = 1volume.cuft
unitconv 1length.ft / 1time.s = 1speed.fps
unitconv 1length.ft = 0.3048metric.length.m
unitconv 1area.sqft = 0.09290304metric.area.m2
unitconv 1volume.floz = 28.4130625metric.volume.ml
unitconv 1weight.lb = 0.45359237metric.weight.kg
unitconv 1speed.fps = 0.3048metric.speed.mps
` },
};

/* =========================================================================================
 * scopes
 * ========================================================================================= */
class Scope {
  constructor(parent, frame) { this.vars = new Map(); this.parent = parent; this.frame = frame || (parent && parent.frame) || null; }
  lookup(name) { for (let s = this; s; s = s.parent) if (s.vars.has(name)) return s; return null; }
  get(name) { const s = this.lookup(name); return s ? s.vars.get(name) : undefined; }
  def(name, v) { this.vars.set(name, v); }
}

/* =========================================================================================
 * interpreter
 * ========================================================================================= */
class Interp {
  constructor(opts) {
    this.opts = opts;
    this.argv = (opts.args || []).slice();
    this.out = opts.print || (s => console.log(s));
    this.errOut = opts.error || (s => console.error(s));
    this.global = new Scope(null, null);
    this.components = new Map();
    this.routes = [];
    this.windows = [];
    this.line = 0;
    this.steps = 0;
    this.maxSteps = opts.maxSteps || 0;
    this.rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
    this.installBuiltins();
  }

  /* ---------------- running */
  run(src, name, repl) {
    let prog;
    try { prog = parse(src, name); }
    catch (e) {
      if (e instanceof CompileError) { this.errOut(`${name || "main.fw"}:${e.line}:${e.col}: error: ${e.message}`); return { status: 1, compileError: e }; }
      throw e;
    }
    return this.exec(prog, repl);
  }
  exec(prog, repl) {
    try {
      this.hoist(prog, this.global);
      for (const st of prog) {
        if (repl && st.k === "Expr" && !(st.e.k === "Call" && st.e.callee.k === "Ident" && st.e.callee.name === "print")) {
          this.line = st.line;
          const v = this.evalExprStmt(st.e, this.global);
          if (v !== null && v !== undefined) this.out(this.show(v, false));
          continue;
        }
        this.execStmt(st, this.global);
      }
      return { status: 0, value: null };
    } catch (e) {
      if (e instanceof ReturnSig) {
        const v = e.v;
        if (v instanceof FwElement) return { status: 0, value: v };
        if (typeof v === "bigint") return { status: Number(v), value: null };
        return { status: 0, value: v };
      }
      if (e instanceof FwThrow) { this.errOut(`Flywheel runtime error: ${this.describeError(e.value)}${this.line ? ` (line ${this.line})` : ""}`); return { status: 1, error: e.value }; }
      if (e instanceof ExitSig) return { status: e.code, value: null };
      if (e instanceof RangeError && /call stack/i.test(e.message)) { this.errOut("Flywheel runtime error: stack overflow"); return { status: 1 }; }
      if (e instanceof StepLimit) { this.errOut("Flywheel runtime error: time limit exceeded (flywheel.js stops programs that run too long)"); return { status: 1 }; }
      this.errOut(`flywheel.js internal error: ${e && e.message || e}${this.line ? ` (line ${this.line})` : ""}`);
      if (typeof console !== "undefined") console.error(e);
      return { status: 1 };
    }
  }
  describeError(v) {
    if (v instanceof FwError) return v.type === "Error" ? v.message : `${v.type}: ${v.message}`;
    if (v instanceof Instance) return `${v.cls.name}: ${this.show(v, false)}`;
    return this.show(v, false);
  }
  // Call a Flywheel function from the host (event handlers); returns an error string or null.
  callFromHost(fn, args) {
    try { this.call(fn, args); return null; }
    catch (e) {
      if (e instanceof FwThrow) return `Flywheel runtime error: ${this.describeError(e.value)}`;
      if (e instanceof StepLimit) return "Flywheel runtime error: time limit exceeded";
      if (e instanceof ExitSig) return null;
      if (e instanceof RangeError) return "Flywheel runtime error: stack overflow";
      return `flywheel.js internal error: ${e && e.message || e}`;
    }
  }

  /* ---------------- declarations */
  hoist(stmts, scope) {
    for (const st of stmts) {
      switch (st.k) {
        case "Func": scope.def(st.name, new FwFunc(st.name, st.params, st.body, scope)); break;
        case "Interface": { const c = new FwClass(st.name); c.isInterface = true; c.sigs = st.sigs; scope.def(st.name, c); break; }
        case "Class": { const c = new FwClass(st.name); c.decl = st; scope.def(st.name, c); break; }
        case "Enum": scope.def(st.name, this.makeEnum(st, scope)); break;
        case "Component": this.components.set(st.name, new Component(st.name, st.node, scope)); break;
        case "Import": this.doImport(st, scope); break;
      }
    }
    const unitDecls = stmts.filter(st => st.k === "UnitNs" || st.k === "UnitDecl" || st.k === "UnitConv");
    if (unitDecls.length) this.declareUnits(unitDecls, null, true);
    for (const st of stmts) {
      if (st.k === "Interface") { const c = scope.get(st.name); c.ifaces = st.bases.map(b => this.typeRef(b, scope)).filter(Boolean); }
      if (st.k === "Class") this.buildClass(scope.get(st.name), st, scope);
    }
  }
  typeRef(name, scope) {
    const v = name.split(".").reduce((acc, part, i) => i === 0 ? scope.get(part) : acc && this.member(acc, part), null);
    return v;
  }
  buildClass(c, st, scope) {
    if (st.base) {
      const b = this.typeRef(st.base, scope);
      if (!(b instanceof FwClass)) throw new CompileError(`unknown base class '${st.base}'`, st.line, 1);
      c.base = b;
    }
    c.ifaces = st.ifaces.map(n => { const i = this.typeRef(n, scope); if (!(i instanceof FwClass)) throw new CompileError(`unknown interface '${n}'`, st.line, 1); return i; });
    c.ownFields = st.fields;
    c.scope = scope;
    for (const m of st.methods) c.methods.set(m.name, new FwFunc(m.name, m.params, m.body, scope, { cls: c, method: true }));
    c.private = new Set([...st.fields, ...st.methods].filter(x => x.mods && x.mods.has("private")).map(x => x.name));
  }
  allFields(c) {
    if (c._all) return c._all;
    const fs = c.base ? this.allFields(c.base).slice() : [];
    for (const f of c.ownFields || []) fs.push(f);
    return (c._all = fs);
  }
  makeEnum(st, scope) {
    const en = new FwEnum(st.name);
    st.members.forEach((m, i) => {
      const mem = new EnumMember(en, m.name, i, m.fields);
      if (!m.fields) mem.value = new EnumVal(en, mem, null);
      en.members.push(mem); en.byName.set(m.name, mem);
    });
    en.scope = scope;
    en.hasData = st.members.some(m => m.fields);
    return en;
  }
  doImport(st, scope) {
    if (st.native) throw new FwThrow(new FwError("NativeError", `native imports (import ${st.native === "cxx" ? "c++" : st.native}) are not available in flywheel.js; install Flywheel to compile ${st.native === "cxx" ? "C++" : st.native === "c" ? "C" : st.native === "rust" ? "Rust" : "Zig"} code`));
    if (st.file) throw new FwThrow(new FwError("RuntimeError", `importing files and URLs ('${st.path}') is not available in flywheel.js; install Flywheel to use them`));
    const root = st.path.split(".")[0];
    if (UNIT_LIBRARIES[root] && !st.wildcard) this.loadUnitLibrary(root, st.alias || root, true);
    if (root === "metric" || root === "imperial") { scope.def(st.alias || root, new Module(root, new Map())); return; }
    const mod = this.modules[root];
    if (!mod) {
      const native = ["fs", "io", "net", "thread", "sqlite", "compress", "crypto", "gc", "toml", "yaml", "csv", "url", "log", "args", "bigint", "decimal"];
      if (native.includes(root)) throw new FwThrow(new FwError("RuntimeError", `module '${root}' is not available in flywheel.js; install Flywheel to use it`));
      throw new FwThrow(new FwError("RuntimeError", `unknown module '${st.path}'`));
    }
    if (st.wildcard && (root === "html" || root === "svg")) { scope.def(root, mod); return; }    // tag sets
    if (st.wildcard) { for (const [k, v] of mod.members) scope.def(k, v); return; }
    scope.def(st.alias || root, mod);
  }

  /* ---------------- statements */
  tick() { if (this.maxSteps && ++this.steps > this.maxSteps) throw new StepLimit(); }
  execBlock(stmts, scope) {
    const s = new Scope(scope);
    let defers = null;
    try {
      for (const st of stmts) {
        if (st.k === "Defer") { (defers = defers || []).push(st.body); continue; }
        this.execStmt(st, s);
      }
    } finally {
      if (defers) for (let i = defers.length - 1; i >= 0; i--) this.execBlock(defers[i], s);
    }
  }
  execStmt(st, scope) {
    this.line = st.line || this.line;
    this.tick();
    switch (st.k) {
      case "Nop": case "Func": case "Class": case "Interface": case "Enum": case "Component": case "Import":
      case "UnitNs": case "UnitDecl": case "UnitConv": return;
      case "Expr": this.evalExprStmt(st.e, scope); return;
      case "Var": {
        let v;
        if (st.value) { const prev = this.expectType; this.expectType = st.type; try { v = this.evalWithType(st.value, scope, st.type); } finally { this.expectType = prev; } }
        else v = this.defaultFor(st.type);
        if (st.type) v = this.coerce(v, st.type, scope);
        scope.def(st.name, v); return;
      }
      case "Destructure": {
        const v = this.eval(st.value, scope);
        const items = seqItems(v);
        if (!items) fail("ValueError", "cannot destructure " + this.typeName(v));
        if (items.length !== st.names.length) fail("ValueError", `expected ${st.names.length} values, got ${items.length}`);
        st.names.forEach((n, i) => { if (n !== "_") scope.def(n, items[i]); });
        return;
      }
      case "Assign": this.assign(st, scope); return;
      case "If": {
        for (const b of st.branches) if (this.cond(b.cond, scope)) { this.execBlock(b.body, scope); return; }
        if (st.otherwise) this.execBlock(st.otherwise, scope);
        return;
      }
      case "While":
        while (this.cond(st.cond, scope)) {
          try { this.execBlock(st.body, scope); }
          catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; }
        }
        return;
      case "For": this.execFor(st, scope); return;
      case "Match": this.execMatch(st, scope); return;
      case "Try": this.execTry(st, scope); return;
      case "Return": throw new ReturnSig(st.value ? this.eval(st.value, scope) : null);
      case "Break": throw BREAK;
      case "Continue": throw CONTINUE;
      case "Throw": {
        const v = this.eval(st.value, scope);
        if (st.name !== undefined) throw new FwThrow(new FwError(st.name, this.show(v, false)));
        if (v === null) fail("RuntimeError", "cannot throw null");
        throw new FwThrow(v);
      }
      case "Assert": {
        const c = this.eval(st.cond, scope);
        if (typeof c !== "boolean") fail("CastError", `condition must be bool, got ${this.typeName(c)}`);
        if (!c) fail("AssertionError", st.msg ? this.show(this.eval(st.msg, scope), false) : "assertion failed");
        return;
      }
      case "Defer": this.execBlock(st.body, scope); return;
    }
    throw new Error("unknown statement " + st.k);
  }
  evalExprStmt(e, scope) {
    // bare function names and member callables invoke zero-argument functions
    if (e.k === "Ident" || e.k === "Member" || e.k === "InstField") {
      const v = this.eval(e, scope);
      if (v instanceof FwFunc || v instanceof Bound || v instanceof Native) return this.call(v, []);
      if (v instanceof FwClass) fail("RuntimeError", `class reference '${v.name}' on its own does nothing`);
      return v;
    }
    return this.eval(e, scope);
  }
  cond(e, scope) {
    const v = this.eval(e, scope);
    if (typeof v !== "boolean") fail("CastError", `condition must be bool, got ${this.typeName(v)}`);
    return v;
  }
  execFor(st, scope) {
    const it = this.eval(st.iter, scope);
    const two = st.names.length === 2;
    const body = (a, b) => {
      const s = new Scope(scope);
      s.def(st.names[0], a); if (two) s.def(st.names[1], b);
      try { this.execBlock(st.body, s); }
      catch (e) { if (e === CONTINUE) return true; if (e === BREAK) return false; throw e; }
      return true;
    };
    if (Array.isArray(it) || it instanceof Tuple) {
      const items = seqItems(it), n = items.length;
      for (let i = 0; i < n; i++) {
        if (i >= items.length) fail("IndexError", "index out of bounds");
        if (!(two ? body(BigInt(i), items[i]) : body(items[i]))) break;
      }
    } else if (typeof it === "string") {
      let i = 0;
      for (const ch of it) { const c = new FwChar(ch.codePointAt(0)); if (!(two ? body(BigInt(i), c) : body(c))) break; i++; }
    } else if (it instanceof FwMap) {
      for (const ent of [...it.m.values()]) if (!(two ? body(ent.k, ent.v) : body(ent.k))) break;
    } else if (it instanceof FwSet) {
      let i = 0;
      for (const v of it.items()) { if (!(two ? body(BigInt(i), v) : body(v))) break; i++; }
    } else if (it instanceof Instance) {
      let src = it;
      if (!findMethod(it.cls, "next") && findMethod(it.cls, "iterator")) src = this.callMethod(it, "iterator", []);
      if (!(src instanceof Instance) || !findMethod(src.cls, "next")) fail("RuntimeError", `${it.cls.name} is not iterable`);
      let i = 0;
      for (;;) { const v = this.callMethod(src, "next", []); if (v === null) break; if (!(two ? body(BigInt(i), v) : body(v))) break; i++; }
    } else if (it instanceof JsonVal && Array.isArray(it.v)) {
      for (const v of it.v) if (!body(new JsonVal(v))) break;
    } else fail("RuntimeError", `cannot iterate over ${this.typeName(it)}`);
  }
  execTry(st, scope) {
    try {
      try { this.execBlock(st.body, scope); }
      catch (e) {
        if (!(e instanceof FwThrow) && !(e instanceof RangeError && false)) throw e;
        const v = e.value;
        for (const c of st.catches) {
          if (this.catchMatches(c.type, v, scope)) {
            const s = new Scope(scope);
            if (c.name) s.def(c.name, v);
            this.execBlock(c.body, s);
            return;
          }
        }
        throw e;
      }
    } finally {
      if (st.fin) this.execBlock(st.fin, scope);
    }
  }
  catchMatches(type, v, scope) {
    if (!type || type === "Error") return true;
    if (v instanceof FwError) return v.type === type;
    if (v instanceof Instance && v.cls.name === type) return true;
    const cls = scope.get(type);
    if (cls instanceof FwClass && v instanceof Instance) return isSubclass(v.cls, cls);
    return false;
  }
  execMatch(st, scope) {
    const v = this.eval(st.subject, scope);
    for (const c of st.cases) {
      for (const pat of c.pats) {
        const s = new Scope(scope);
        if (this.matchPat(pat, v, s) && (!c.guard || this.cond(c.guard, s))) { this.execBlock(c.body, s); return; }
      }
    }
    if (st.otherwise) { this.execBlock(st.otherwise, scope); return; }
    fail("RuntimeError", `no case matched ${this.show(v, true)}`);
  }
  matchPat(p, v, s) {
    switch (p.p) {
      case "Skip": return true;
      case "Bind": s.def(p.name, v); return true;
      case "Value": return this.eq(v, this.eval(p.e, s));
      case "Range": {
        const lo = this.eval(p.lo, s), hi = this.eval(p.hi, s);
        const val = v instanceof FwChar ? BigInt(v.cp) : v;
        const l = lo instanceof FwChar ? BigInt(lo.cp) : lo, h = hi instanceof FwChar ? BigInt(hi.cp) : hi;
        if (!isNum(val)) return false;
        return val >= l && (p.incl ? val <= h : val < h);
      }
      case "Result": if (!(v instanceof ResultVal) || v.ok !== p.ok) return false; s.def(p.bind, v.v); return true;
      case "Type": {
        if (!this.isType(v, p.type, s)) return false;
        s.def(p.bind, v); return true;
      }
      case "Name": {
        // enum member (qualified or unqualified), class/interface type test, or a value
        if (p.e.k === "Ident" && v instanceof EnumVal) {
          const mem = v.en.byName.get(p.e.name);
          if (mem) return v.member === mem;
        }
        let target;
        try { target = this.eval(p.e, s); } catch (e) { throw e; }
        if (target instanceof EnumMember) return v instanceof EnumVal && v.member === target;
        if (target instanceof FwClass) return v instanceof Instance && isSubclass(v.cls, target);
        return this.eq(v, target);
      }
      case "Seq": {
        const items = seqItems(v);
        if (!items || items.length !== p.items.length) return false;
        return p.items.every((ip, i) => this.matchPat(ip, items[i], s));
      }
      case "Destructure": {
        const target = this.eval(p.callee, s);
        if (target instanceof EnumMember) {
          if (!(v instanceof EnumVal) || v.member !== target) return false;
          const vals = [...v.fields.values()];
          if (p.items.length !== vals.length) fail("RuntimeError", `${target.en.name}.${target.name} has ${vals.length} fields`);
          return p.items.every((ip, i) => this.matchPat(ip, vals[i], s));
        }
        fail("RuntimeError", "invalid pattern");
      }
    }
    return false;
  }

  /* ---------------- assignment */
  assign(st, scope) {
    const t = st.target;
    const compute = old => {
      const v = this.eval(st.value, scope);
      if (st.op === "=") return v;
      return this.binary(st.op.slice(0, -1), old, v);
    };
    switch (t.k) {
      case "Ident": {
        const s = scope.lookup(t.name);
        if (!s) fail("RuntimeError", `unknown variable '${t.name}'`);
        const old = s.vars.get(t.name);
        s.vars.set(t.name, st.op === "=" ? compute() : compute(old)); return;
      }
      case "InstField": {
        const self = this.self(scope);
        if (!self.f.has(t.name) && !this.allFields(self.cls).some(f => f.name === t.name)) fail("RuntimeError", `${self.cls.name} has no field '${t.name}'`);
        self.f.set(t.name, st.op === "=" ? compute() : compute(self.f.get(t.name))); return;
      }
      case "Member": {
        const obj = this.eval(t.e, scope);
        const old = st.op === "=" ? undefined : this.member(obj, t.name);
        this.setMember(obj, t.name, st.op === "=" ? compute() : compute(old)); return;
      }
      case "Index": {
        const obj = this.eval(t.e, scope), idx = this.eval(t.index, scope);
        const old = st.op === "=" ? undefined : this.index(obj, idx);
        this.setIndex(obj, idx, st.op === "=" ? compute() : compute(old)); return;
      }
    }
  }
  setMember(obj, name, v) {
    if (obj instanceof Instance) {
      if (!this.allFields(obj.cls).some(f => f.name === name)) fail("RuntimeError", `${obj.cls.name} has no field '${name}'`);
      obj.f.set(name, v); return;
    }
    if (obj instanceof FwElement) {
      if (name === "text_content") { this.elSetText(obj, v); return; }
      if (name === "id" || name === "class_name") { obj.attrs.set(name === "id" ? "id" : "class", this.show(v, false)); return; }
    }
    fail("RuntimeError", `cannot assign to '${name}' on ${this.typeName(obj)}`);
  }
  setIndex(obj, idx, v) {
    if (Array.isArray(obj) || obj instanceof Tuple) {
      const items = seqItems(obj);
      if (obj.frozen) fail("ValueError", "cannot modify a frozen array");
      const i = this.idxNum(idx, items.length);
      items[i] = v; return;
    }
    if (obj instanceof FwMap) { obj.set(this, idx, v); return; }
    if (obj instanceof Instance) { const m = findMethod(obj.cls, "operator []="); if (m) { this.call(new Bound(m, obj), [idx, v]); return; } }
    fail("RuntimeError", `cannot index-assign ${this.typeName(obj)}`);
  }
  idxNum(idx, len) {
    if (typeof idx !== "bigint") fail("CastError", "index must be int");
    const i = Number(idx);
    if (i < 0 || i >= len) fail("IndexError", "index out of bounds");
    return i;
  }

  /* ---------------- expressions */
  self(scope) {
    const f = scope.frame;
    if (!f || !f.self) fail("RuntimeError", "'inst' used outside a method");
    return f.self;
  }
  evalWithType(e, scope, type) {
    if (e.k === "EmptyBraces" && type) return type.name === "set" ? new FwSet() : new FwMap();
    if (e.k === "SetLit" && type && type.name === "map") fail("RuntimeError", "map literal needs key: value pairs");
    if (e.k === "List" && type && type.tuple) return new Tuple(e.items.map(i => this.eval(i, scope)));
    return this.eval(e, scope);
  }
  defaultFor(t) {
    if (!t) return null;
    if (t.opt) return null;
    if (t.arr) return [];
    switch (t.name) {
      case "int": case "i8": case "i16": case "i32": case "i64": case "u8": case "u16": case "u32": case "u64": return 0n;
      case "double": case "float": case "f32": case "f64": return 0;
      case "string": return "";
      case "bool": return false;
      case "char": return new FwChar(0);
      case "map": return new FwMap();
      case "set": return new FwSet();
      case "array": return [];
    }
    return null;
  }
  coerce(v, t, scope) {
    if (!t || v === null) return v;
    if (t.opt) return this.coerce(v, t.opt, scope);
    if (t.unit) {
      const ns = this.typeUnitSpace(t.unit), spelled = `${t.unit.real ? "float" : "int"}[${ns.name}]`;
      if (v instanceof Quantity) {
        if (v.ns !== ns) fail("CastError", `cannot convert ${this.typeName(v)} to ${spelled}: they are in different unit namespaces`);
        return t.unit.real && typeof v.amount === "bigint" ? new Quantity(v.ns, Number(v.amount), v.unit) : v;
      }
      if (isNum(v)) fail("CastError", `cannot use ${this.typeName(v)} as ${spelled}; give the number a unit, such as 5${ns.units[0]}`);
    }
    if (v instanceof Quantity && t.name && UNIT_NUMBERS.has(t.name))
      fail("CastError", `cannot convert ${this.typeName(v)} to ${t.name}; use .value for the number, or \`in\` to change its unit`);
    if ((t.name === "double" || t.name === "float") && typeof v === "bigint") return Number(v);
    if (t.arr && Array.isArray(v) && t.arr.name && (t.arr.name === "double" || t.arr.name === "float")) {
      for (let i = 0; i < v.length; i++) if (typeof v[i] === "bigint") v[i] = Number(v[i]);
    }
    if (t.tuple && Array.isArray(v)) return new Tuple(v.map((x, i) => this.coerce(x, t.tuple[i], scope)));
    if (t.name === "set" && v instanceof FwMap && v.size === 0) return new FwSet();
    return v;
  }
  eval(e, scope) {
    switch (e.k) {
      case "Lit": return e.v;
      case "Qty": this.line = e.line || this.line; return this.quantityLiteral(e.v, e.unit, null, e.text);
      case "Str": {
        let s = "";
        for (const p of e.parts) {
          if (typeof p === "string") s += p;
          else { const v = this.eval(p.e, scope); s += p.spec !== null ? applySpec(this, v, p.spec) : this.show(v, false); }
        }
        return s;
      }
      case "Ident": {
        const s = scope.lookup(e.name);
        if (s) return s.vars.get(e.name);
        if (this.builtins.has(e.name)) return this.builtins.get(e.name);
        this.line = e.line || this.line;
        fail("RuntimeError", `unknown name '${e.name}'`);
      }
      case "Paren": return this.eval(e.e, scope);
      case "Self": return this.self(scope);
      case "InstField": {
        const self = this.self(scope);
        if (self.f.has(e.name)) return self.f.get(e.name);
        const m = findMethod(self.cls, e.name);
        if (m) return new Bound(m, self);
        fail("RuntimeError", `${self.cls.name} has no member '${e.name}'`);
      }
      case "Attr": {
        const a = scope.frame && scope.frame.attrs;
        if (!a) fail("RuntimeError", "'attr' used outside a component");
        if (a.has(e.name)) return a.get(e.name);
        if (e.name === "style") return "";
        if (e.name === "inner") return new FwElement("");
        fail("RuntimeError", `component <${scope.frame.comp}> needs attribute '${e.name}'`);
      }
      case "Super": {
        const f = scope.frame;
        if (!f || !f.cls || !f.cls.base) fail("RuntimeError", "'super' used outside a subclass method");
        const m = findMethod(f.cls.base, e.name);
        if (!m) {
          if (e.name === "init") return new Native("super.init", args => { this.generatedInit(f.cls.base, f.self, args); return null; });
          fail("RuntimeError", `${f.cls.base.name} has no method '${e.name}'`);
        }
        return new Bound(m, f.self);
      }
      case "List": {
        const items = e.items.map(i => this.eval(i, scope));
        return this.homogeneous(items) ? items : new Tuple(items);
      }
      case "MapLit": {
        const m = new FwMap();
        for (const [k, v] of e.entries) m.set(this, this.eval(k, scope), this.eval(v, scope));
        return m;
      }
      case "SetLit": { const s = new FwSet(); for (const i of e.items) s.add(this, this.eval(i, scope)); return s; }
      case "EmptyBraces": return new FwMap();
      case "Unary": {
        const v = this.eval(e.e, scope);
        if (e.op === "+") return v;
        if (typeof v === "bigint") return ck(-v);
        if (typeof v === "number") return -v;
        if (v instanceof Quantity) return new Quantity(v.ns, typeof v.amount === "bigint" ? ck(-v.amount) : -v.amount, v.unit);
        if (v instanceof Instance) { const m = findMethod(v.cls, "operator -"); if (m && m.params.length === 0) return this.call(new Bound(m, v), []); }
        fail("RuntimeError", `cannot negate ${this.typeName(v)}`);
      }
      case "Not": {
        const v = this.eval(e.e, scope);
        if (typeof v !== "boolean") fail("CastError", "'not' needs a bool");
        return !v;
      }
      case "Logic": {
        const l = this.eval(e.l, scope);
        if (typeof l !== "boolean") fail("CastError", `'${e.op}' needs bools`);
        if (e.op === "and" ? !l : l) return l;
        const r = this.eval(e.r, scope);
        if (typeof r !== "boolean") fail("CastError", `'${e.op}' needs bools`);
        return r;
      }
      case "Bin": {
        if (e.op === "??") { const l = this.eval(e.l, scope); return l !== null ? l : this.eval(e.r, scope); }
        if (e.op === "in") {           // `length in cm`: a quantity converted to another unit
          const l = this.eval(e.l, scope);
          this.line = e.line || this.line;
          if (l instanceof Quantity) {
            const target = this.unitTarget(e.r, scope, l);
            if (target !== null) return target.ns === l.ns ? this.unitConvert(l, target.j) : this.unitAcross(l, target.ns, target.j);
          }
          return this.binary("in", l, this.eval(e.r, scope));
        }
        const l = this.eval(e.l, scope), r = this.eval(e.r, scope);
        this.line = e.line || this.line;
        return this.binary(e.op, l, r);
      }
      case "Chain": {
        let left = this.eval(e.items[0], scope);
        for (let i = 0; i < e.ops.length; i++) {
          const right = this.eval(e.items[i + 1], scope);
          if (!this.binary(e.ops[i], left, right)) return false;
          left = right;
        }
        return true;
      }
      case "Is": return this.isType(this.eval(e.e, scope), e.type, scope);
      case "As": {
        const v = this.eval(e.e, scope);
        const t = e.type.opt || e.type;
        if (t.name && PRIM_TYPES.has(t.name)) return this.convert(t.name, v);
        if (this.isType(v, t, scope)) return v;
        if (e.type.opt) return null;
        fail("CastError", `cannot cast ${this.typeName(v)} to ${this.typeStr(e.type)}`);
      }
      case "Member": {
        if (e.e.k === "Qty") {          // 15time.s: a unit qualified by its namespace
          const ns = this.unitSpace(e.e.unit, null);
          if (ns && ns.index(e.name) >= 0) { this.line = e.line || this.line; return this.quantityLiteral(e.e.v, e.name, ns, e.e.text); }
        }
        const obj = this.eval(e.e, scope);
        this.line = e.line || this.line;
        return this.member(obj, e.name);
      }
      case "Index": {
        const obj = this.eval(e.e, scope);
        if (e.index.k === "Bin" && (e.index.op === ".." || e.index.op === "..<")) {
          const a = this.eval(e.index.l, scope), b = this.eval(e.index.r, scope);
          return this.slice(obj, Number(a), Number(b) + (e.index.op === ".." ? 1 : 0));
        }
        this.line = e.line || this.line;
        return this.index(obj, this.eval(e.index, scope));
      }
      case "Call": {
        this.line = e.line || this.line;
        if (e.callee.k === "Member") {
          const obj = this.eval(e.callee.e, scope);
          const args = e.args.map(a => this.eval(a, scope));
          return this.callMember(obj, e.callee.name, args);
        }
        const f = this.eval(e.callee, scope);
        const args = e.args.map(a => this.eval(a, scope));
        return this.call(f, args);
      }
      case "TypeApp": {
        const base = this.eval(e.e, scope);
        if (base instanceof Native && base.typed) return new Native(base.name, args => base.typed(e.args, args));
        return base;
      }
      case "Lambda": return new FwFunc("lambda", e.params, e.body, scope);
      case "JsonLit": return new JsonVal(JSON.parse(JSON.stringify(e.v)));
      case "Which": {
        const v = this.eval(e.e, scope);
        const items = seqItems(v) || (v instanceof FwSet ? v.items() : null);
        if (!items) fail("CastError", `'which' filters an array, tuple, or set, not ${this.typeName(v)}`);
        const f = new FwFunc("lambda", e.fn.params, e.fn.body, scope);
        return items.filter(x => {
          const r = this.call(f, [x]);
          if (typeof r !== "boolean") fail("CastError", `'which' condition must be bool, got ${this.typeName(r)}`);
          return r;
        });
      }
      case "Markup": return this.evalMarkup(e, scope);
    }
    throw new Error("cannot evaluate " + e.k);
  }
  homogeneous(items) {
    if (items.length < 2) return true;
    const k = v => typeof v === "bigint" ? "i" : typeof v === "number" ? "d" : typeof v === "string" ? "s" : typeof v === "boolean" ? "b" :
      v === null ? "n" : v instanceof FwChar ? "c" : Array.isArray(v) ? "a" : v instanceof Tuple ? "t" : v instanceof FwMap ? "m" : v instanceof FwSet ? "S" :
      v instanceof FwElement ? "el" : v instanceof EnumVal ? "e:" + v.en.name : v instanceof Instance ? "o" : v instanceof ResultVal ? "r" : "f";
    const first = k(items[0]);
    let nulls = 0;
    for (const v of items) { const kk = k(v); if (kk === "n") { nulls++; continue; } if (kk !== first && first !== "n") return false; }
    if (first === "n") { const nonNull = items.filter(v => v !== null).map(k); return new Set(nonNull).size <= 1; }
    return true;
  }

  /* ---------------- operators */
  binary(op, a, b) {
    if ((a instanceof Quantity || b instanceof Quantity) && /^([+\-*/%]|\/\/|[=!<>]=|[<>])$/.test(op)) return this.unitBinary(op, a, b);
    if (a instanceof Instance && !(op === "==" || op === "!=") ) {
      const name = "operator " + (op === ">" || op === "<=" || op === ">=" ? op : op);
      let m = findMethod(a.cls, name);
      if (m) return this.call(new Bound(m, a), [b]);
      if (op === ">" || op === "<=" || op === ">=") {
        const lt = findMethod(a.cls, "operator <");
        if (lt) {
          if (op === ">") return this.call(new Bound(lt, b), [a]);
          if (op === "<=") return !this.call(new Bound(lt, b), [a]);
          if (op === ">=") return !this.call(new Bound(lt, a), [b]);
        }
      }
      if (op !== "in") fail("RuntimeError", `${a.cls.name} has no operator ${op}`);
    }
    switch (op) {
      case "==": return this.eq(a, b);
      case "!=": return !this.eq(a, b);
      case "<": return this.cmp(a, b) < 0;
      case "<=": return this.cmp(a, b) <= 0;
      case ">": return this.cmp(a, b) > 0;
      case ">=": return this.cmp(a, b) >= 0;
      case "in": return this.contains(b, a);
      case "..": case "..<": {
        if (typeof a !== "bigint" || typeof b !== "bigint") fail("CastError", "range endpoints must be int");
        const end = op === ".." ? b : b - 1n;
        if (end - a > 10000000n) fail("NumericError", "range too large for flywheel.js");
        const items = [];
        for (let i = a; i <= end; i++) items.push(i);
        return new Tuple(items);
      }
      case "+":
        if (typeof a === "string" || a instanceof FwChar) {
          if (typeof b === "string" || b instanceof FwChar) return String(a) + String(b);
          fail("CastError", `cannot add ${this.typeName(a)} and ${this.typeName(b)}; use string(...) or interpolation`);
        }
        if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
        return this.arith(op, a, b);
      case "*":
        if ((isSeq(a) || typeof a === "string") && typeof b === "bigint") return this.repeat(a, b);
        if ((isSeq(b) || typeof b === "string") && typeof a === "bigint") return this.repeat(b, a);
        return this.arith(op, a, b);
      default: return this.arith(op, a, b);
    }
  }
  repeat(v, n) {
    if (n < 0n) fail("ValueError", "negative repetition count");
    const k = Number(n);
    if (typeof v === "string") return v.repeat(k);
    const items = seqItems(v), out = [];
    for (let i = 0; i < k; i++) out.push(...items);
    return Array.isArray(v) ? out : new Tuple(out);
  }
  arith(op, a, b) {
    if (!isNum(a) || !isNum(b)) fail("CastError", `operator ${op} needs numbers, got ${this.typeName(a)} and ${this.typeName(b)}`);
    if (typeof a === "bigint" && typeof b === "bigint") {
      switch (op) {
        case "+": return ck(a + b);
        case "-": return ck(a - b);
        case "*": return ck(a * b);
        case "/": if (b === 0n) fail("NumericError", "division by zero"); return Number(a) / Number(b);
        case "//": if (b === 0n) fail("NumericError", "division by zero"); return ck(a / b);
        case "%": if (b === 0n) fail("NumericError", "division by zero"); return a % b;
      }
    }
    const x = Number(a), y = Number(b);
    switch (op) {
      case "+": return x + y;
      case "-": return x - y;
      case "*": return x * y;
      case "/": return x / y;
      case "//": { if (y === 0) fail("NumericError", "division by zero"); const q = Math.trunc(x / y); if (!Number.isFinite(q)) fail("NumericError", "integer overflow"); return ck(BigInt(q)); }
      case "%": return x % y;
    }
    fail("RuntimeError", "unknown operator " + op);
  }
  eq(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (a instanceof Quantity || b instanceof Quantity)
      return a instanceof Quantity && b instanceof Quantity &&
        (a.ns === b.ns || this.unitState().equiv.has(b.ns.id + "=" + a.ns.id)) && this.unitBinary("==", a, b);
    if (isNum(a) && isNum(b)) return a == b;   // eslint-disable-line eqeqeq
    if (a instanceof FwChar && b instanceof FwChar) return a.cp === b.cp;
    if (a instanceof EnumVal && b instanceof EnumVal) {
      if (a.member !== b.member) return false;
      if (!a.fields) return true;
      for (const [k, v] of a.fields) if (!this.deepEq(v, b.fields.get(k))) return false;
      return true;
    }
    if (a instanceof Instance) {
      const m = findMethod(a.cls, "operator ==") || findMethod(a.cls, "equals");
      if (m && b instanceof Instance) return !!this.call(new Bound(m, a), [b]);
      return false;
    }
    if (a instanceof Tuple && b instanceof Tuple) return a.items.length === b.items.length && a.items.every((x, i) => this.eq(x, b.items[i]));
    if (a instanceof ResultVal && b instanceof ResultVal) return a.ok === b.ok && this.eq(a.v, b.v);
    if (a instanceof JsonVal && b instanceof JsonVal) return JSON.stringify(a.v) === JSON.stringify(b.v);
    return false;
  }
  deepEq(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => this.deepEq(x, b[i]));
    if (a instanceof Tuple && b instanceof Tuple) return a.items.length === b.items.length && a.items.every((x, i) => this.deepEq(x, b.items[i]));
    return this.eq(a, b);
  }
  cmp(a, b) {
    if (a instanceof Quantity && b instanceof Quantity) return this.unitBinary("<", a, b) ? -1 : this.unitBinary(">", a, b) ? 1 : 0;
    if (isNum(a) && isNum(b)) return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === "string" && typeof b === "string") { const x = cps(a), y = cps(b); for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i].codePointAt(0) - y[i].codePointAt(0); if (d) return d; } return x.length - y.length; }
    if (a instanceof FwChar && b instanceof FwChar) return a.cp - b.cp;
    if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
    if (a instanceof EnumVal && b instanceof EnumVal) return a.member.index - b.member.index;
    if (a instanceof Instance) {
      const lt = findMethod(a.cls, "operator <");
      if (lt) return this.call(new Bound(lt, a), [b]) ? -1 : this.call(new Bound(lt, b), [a]) ? 1 : 0;
    }
    fail("CastError", `cannot compare ${this.typeName(a)} and ${this.typeName(b)}`);
  }
  contains(coll, x) {
    if (typeof coll === "string") {
      if (x instanceof FwChar) return coll.includes(String(x));
      if (typeof x === "string") return coll.includes(x);
    }
    if (Array.isArray(coll) || coll instanceof Tuple) return seqItems(coll).some(v => this.eq(v, x));
    if (coll instanceof FwMap) return coll.has(this, x);
    if (coll instanceof FwSet) return coll.has(this, x);
    if (coll instanceof JsonVal && coll.v && typeof coll.v === "object") return typeof x === "string" && x in coll.v;
    fail("CastError", `'in' is not supported for ${this.typeName(coll)}`);
  }
  isType(v, t, scope) {
    if (t.opt) return v === null || this.isType(v, t.opt, scope);
    if (v === null) return false;
    if (t.arr) return Array.isArray(v);
    if (t.tuple) return v instanceof Tuple;
    if (t.fn) return v instanceof FwFunc || v instanceof Bound || v instanceof Native;
    switch (t.name) {
      case "int": case "i8": case "i16": case "i32": case "i64": case "u8": case "u16": case "u32": case "u64": return typeof v === "bigint";
      case "double": case "float": case "f32": case "f64": return typeof v === "number";
      case "string": return typeof v === "string";
      case "bool": return typeof v === "boolean";
      case "char": return v instanceof FwChar;
      case "element": case "fragment": return v instanceof FwElement;
      case "array": return Array.isArray(v);
      case "tuple": return v instanceof Tuple;
      case "map": return v instanceof FwMap;
      case "set": return v instanceof FwSet;
      case "Result": return v instanceof ResultVal;
    }
    if (ERROR_TYPES.includes(t.name)) return v instanceof FwError && (t.name === "Error" || v.type === t.name);
    const target = this.typeRef(t.name, scope);
    if (target instanceof FwClass) return v instanceof Instance && isSubclass(v.cls, target);
    if (target instanceof EnumMember) return v instanceof EnumVal && v.member === target;
    if (target instanceof FwEnum) return v instanceof EnumVal && v.en === target;
    fail("RuntimeError", `unknown type '${t.name}'`);
  }

  /* ---------------- indexing and members */
  index(obj, idx) {
    if (Array.isArray(obj)) return obj[this.idxNum(idx, obj.length)];
    if (obj instanceof Tuple) return obj.items[this.idxNum(idx, obj.items.length)];
    if (typeof obj === "string") {
      const chars = cps(obj);
      return new FwChar(chars[this.idxNum(idx, chars.length)].codePointAt(0));
    }
    if (obj instanceof FwMap) {
      const ent = obj.get(this, idx);
      if (!ent) fail("KeyError", "map key not found");
      return ent.v;
    }
    if (obj instanceof Instance) {
      const m = findMethod(obj.cls, "operator []");
      if (m) return this.call(new Bound(m, obj), [idx]);
    }
    if (obj instanceof JsonVal) {
      const v = obj.v;
      if (typeof idx === "string") { if (v && typeof v === "object" && !Array.isArray(v) && idx in v) return new JsonVal(v[idx]); fail("JsonError", `missing key "${idx}"`); }
      if (typeof idx === "bigint" && Array.isArray(v)) return new JsonVal(v[this.idxNum(idx, v.length)]);
      fail("JsonError", "invalid JSON index");
    }
    if (obj === null) fail("CastError", "indexing a null value");
    fail("RuntimeError", `cannot index ${this.typeName(obj)}`);
  }
  slice(obj, a, b) {
    const norm = (i, n) => i < 0 ? Math.max(0, n + i) : Math.min(i, n);
    if (typeof obj === "string") { const c = cps(obj); const n = c.length; return c.slice(norm(a, n), b === undefined ? n : norm(b, n)).join(""); }
    const items = seqItems(obj);
    if (!items) fail("RuntimeError", `cannot slice ${this.typeName(obj)}`);
    const n = items.length, r = items.slice(norm(a, n), b === undefined ? n : norm(b, n));
    return obj instanceof Tuple ? new Tuple(r) : r;
  }
  member(obj, name) {
    if (obj === null) fail("CastError", `member '${name}' of a null value`);
    if (obj instanceof Quantity) {
      if (name === "value") return obj.amount;
      fail("RuntimeError", `${this.typeName(obj)} has no member '${name}'`);
    }
    if (obj instanceof Instance) {
      if (obj.f.has(name)) return obj.f.get(name);
      const m = findMethod(obj.cls, name);
      if (m) return new Bound(m, obj);
      fail("RuntimeError", `${obj.cls.name} has no member '${name}'`);
    }
    if (obj instanceof Module) {
      if (obj.members.has(name)) return obj.members.get(name);
      fail("RuntimeError", `module ${obj.name} has no member '${name}'${obj.name === "web" || obj.name === "desktop" ? " in flywheel.js" : ""}`);
    }
    if (obj instanceof FwEnum) {
      const mem = obj.byName.get(name);
      if (mem) return mem.value || mem;
      if (name === "values") return new Native("values", () => obj.members.filter(m => m.value).map(m => m.value));
      if (name === "from_name") return new Native("from_name", ([n]) => { const m = obj.byName.get(n); return m && m.value || null; });
      fail("RuntimeError", `${obj.name} has no member '${name}'`);
    }
    if (obj instanceof EnumVal) {
      if (name === "name") return obj.member.name;
      if (name === "value") return BigInt(obj.member.index);
      if (obj.fields && obj.fields.has(name)) return obj.fields.get(name);
    }
    if (obj instanceof FwClass) {
      if (name === "from_json") return new Native("from_json", ([text]) => this.jsonDecodeClass(obj, text));
    }
    if (obj instanceof FwError) {
      if (name === "message") return obj.message;
      if (name === "name" || name === "type") return obj.type;
    }
    if (obj instanceof ResultVal) {
      if (name === "is_ok") return obj.ok;
      if (name === "is_error") return !obj.ok;
    }
    const props = this.props(obj, name);
    if (props !== undefined) return props;
    const m = this.methodOf(obj, name);
    if (m) return new Native(name, args => m(args));
    fail("RuntimeError", `${this.typeName(obj)} has no member '${name}'`);
  }
  callMember(obj, name, args) {
    if (obj instanceof Instance) {
      if (obj.f.has(name)) return this.call(obj.f.get(name), args);
      const m = findMethod(obj.cls, name);
      if (m) return this.call(new Bound(m, obj), args);
      fail("RuntimeError", `${obj.cls.name} has no method '${name}'`);
    }
    if (obj instanceof ResultVal || obj instanceof EnumVal || obj instanceof FwClass || obj instanceof FwEnum || obj instanceof Module || obj instanceof FwError) {
      if (obj instanceof ResultVal) {
        if (name === "is_ok") return obj.ok;
        if (name === "is_error") return !obj.ok;
        if (name === "unwrap") { if (!obj.ok) fail("ResultError", "unwrap on an error result"); return obj.v; }
        if (name === "error") { if (obj.ok) fail("ResultError", "error() on an ok result"); return obj.v; }
        if (name === "unwrap_or") return obj.ok ? obj.v : args[0];
      }
      return this.call(this.member(obj, name), args);
    }
    if (name === "call" && (obj instanceof FwFunc || obj instanceof Bound || obj instanceof Native)) return this.call(obj, args);
    const m = this.methodOf(obj, name);
    if (m) return m(args);
    const p = this.props(obj, name);
    if (p !== undefined) return this.call(p, args);
    fail("RuntimeError", `${this.typeName(obj)} has no method '${name}'`);
  }

  /* ---------------- calls */
  call(f, args) {
    this.tick();
    if (f instanceof Bound) return this.invoke(f.fn, args, f.self);
    if (f instanceof FwFunc) return this.invoke(f, args, null);
    if (f instanceof Native) return f.fn(args);
    if (f instanceof FwClass) return this.construct(f, args);
    if (f instanceof EnumMember) {
      if (!f.fields) return f.value;
      const fields = new Map();
      f.fields.forEach((p, i) => {
        let v = i < args.length ? args[i] : p.def ? this.eval(p.def, f.en.scope) : fail("RuntimeError", `${f.en.name}.${f.name} needs '${p.name}'`);
        fields.set(p.name, this.coerce(v, p.type));
      });
      if (args.length > f.fields.length) fail("RuntimeError", `too many arguments for ${f.en.name}.${f.name}`);
      return new EnumVal(f.en, f, fields);
    }
    if (f === null || f === undefined) fail("CastError", "calling a null value");
    fail("RuntimeError", `${this.typeName(f)} is not callable`);
  }
  invoke(fn, args, self) {
    const frame = { self: self || (fn.isMethod ? null : null), cls: fn.cls, attrs: null };
    if (!self && fn.closure && fn.closure.frame) { frame.self = fn.closure.frame.self; frame.cls = fn.cls || fn.closure.frame.cls; frame.attrs = fn.closure.frame.attrs; frame.comp = fn.closure.frame.comp; }
    const s = new Scope(fn.closure, frame);
    const ps = fn.params;
    if (args.length > ps.length) fail("RuntimeError", `${fn.name} takes ${ps.length} argument${ps.length === 1 ? "" : "s"}, got ${args.length}`);
    for (let i = 0; i < ps.length; i++) {
      let v;
      if (i < args.length) v = args[i];
      else if (ps[i].def) v = this.eval(ps[i].def, fn.closure);
      else fail("RuntimeError", `${fn.name} is missing argument '${ps[i].name}'`);
      s.def(ps[i].name, this.coerce(v, ps[i].type));
    }
    try { this.execBlock(fn.body, s); }
    catch (e) { if (e instanceof ReturnSig) return e.v; throw e; }
    return null;
  }
  callMethod(obj, name, args) { return this.callMember(obj, name, args); }
  construct(cls, args) {
    if (cls.isInterface) fail("RuntimeError", `interface ${cls.name} cannot be constructed`);
    const o = new Instance(cls);
    const fields = this.allFields(cls);
    for (const f of fields) if (f.def) o.f.set(f.name, this.coerce(this.eval(f.def, cls.scope), f.type));
    const init = findMethod(cls, "init");
    if (init) {
      this.call(new Bound(init, o), args);
      for (const f of fields) if (!o.f.has(f.name)) o.f.set(f.name, this.defaultFor(f.type));
    } else this.generatedInit(cls, o, args);
    return o;
  }
  generatedInit(cls, o, args) {
    const fields = this.allFields(cls);
    if (args.length > fields.length) fail("RuntimeError", `${cls.name} takes at most ${fields.length} arguments, got ${args.length}`);
    fields.forEach((f, i) => {
      if (i < args.length) o.f.set(f.name, this.coerce(args[i], f.type));
      else if (!o.f.has(f.name)) {
        if (f.def) o.f.set(f.name, this.coerce(this.eval(f.def, cls.scope), f.type));
        else fail("RuntimeError", `${cls.name}(...) is missing required field '${f.name}'`);
      }
    });
  }

  /* ---------------- markup */
  evalMarkup(e, scope) {
    const comp = e.tag && this.components.get(e.tag);
    if (comp) {
      const attrs = new Map();
      for (const a of e.attrs) attrs.set(a.name, a.v === null ? true : this.eval(a.v, scope));
      const inner = new FwElement("");
      for (const c of e.children) this.appendChild(inner, c, scope);
      attrs.set("inner", inner);
      if (!attrs.has("style")) attrs.set("style", "");
      const s = new Scope(comp.scope, { self: null, cls: null, attrs, comp: comp.name });
      return this.evalMarkup(comp.node, s);
    }
    if (e.tag && /^[A-Z]/.test(e.tag)) fail("RuntimeError", `unknown component <${e.tag}>`);
    const el = new FwElement(e.tag);
    for (const a of e.attrs) {
      if (a.v === null) { el.attrs.set(a.name, BOOL_ATTRS.has(a.name) ? true : ""); continue; }
      const v = this.eval(a.v, scope);
      if (v === false || v === null) continue;
      el.attrs.set(a.name, v);
    }
    for (const c of e.children) this.appendChild(el, c, scope);
    return el;
  }
  appendChild(el, c, scope) {
    if (c.k === "Text") { el.children.push(c.v); return; }
    if (c.k === "Markup") { const ch = this.evalMarkup(c, scope); ch.parent = el; el.children.push(ch); return; }
    this.insertValue(el, this.eval(c.e, scope));
  }
  insertValue(el, v) {
    if (v === null || v === undefined) return;
    if (v instanceof FwElement) { v.parent = el; el.children.push(v); return; }
    if (Array.isArray(v) || v instanceof Tuple) { for (const x of seqItems(v)) this.insertValue(el, x); return; }
    el.children.push(this.show(v, false));
  }
  render(el, hooks) {
    if (typeof el === "string") return escHtml(el);
    const inner = el.children.map(c => typeof c === "string" ? (el.tag === "style" || el.tag === "script" ? c : escHtml(c)) : this.render(c, hooks)).join("");
    if (!el.tag) return inner;
    let attrs = "";
    for (const [k, v] of el.attrs) {
      if (v instanceof FwFunc || v instanceof Bound || v instanceof Native) { if (hooks) attrs += hooks(el, k, v); continue; }
      if (v === true) attrs += ` ${k}=""`;
      else if (v === false || v === null) continue;
      else attrs += ` ${k}="${escAttr(this.show(v, false))}"`;
    }
    if (hooks && el.attrs.has("id") === false && hooks.tagId) attrs += hooks.tagId(el);
    if (VOID_TAGS.has(el.tag)) return `<${el.tag}${attrs}>`;
    return `<${el.tag}${attrs}>${inner}</${el.tag}>`;
  }
  elText(el) { return el.children.map(c => typeof c === "string" ? c : this.elText(c)).join(""); }
  elSetText(el, v) { if (VOID_TAGS.has(el.tag)) fail("RuntimeError", `<${el.tag}> cannot have children`); el.children = [this.show(v, false)]; }
  namedChildren(el) {
    const out = [];
    for (const c of el.children) if (c instanceof FwElement) { if (c.tag) out.push(c); else out.push(...this.namedChildren(c)); }
    return out;
  }
  namedParent(el) { let p = el.parent; while (p && !p.tag) p = p.parent; return p; }
  descendants(el, out) {
    for (const c of el.children) if (c instanceof FwElement) { if (c.tag) out.push(c); this.descendants(c, out); }
    return out;
  }
  query(el, sel, all) {
    const groups = parseSelector(sel);
    const res = this.descendants(el, []).filter(n => groups.some(g => matchComplex(this, n, g, g.length - 1)));
    return all ? res : res[0] || null;
  }

  /* ---------------- showing values */
  show(v, nested, seen) {
    if (v === null || v === undefined) return "null";
    switch (typeof v) {
      case "string": return nested ? '"' + escStr(v, '"') + '"' : v;
      case "bigint": return v.toString();
      case "number": return fmtG(v);
      case "boolean": return v ? "true" : "false";
    }
    if (v instanceof FwChar) return nested ? "'" + escStr(String(v), "'") + "'" : String(v);
    if (v instanceof Quantity) return this.show(v.amount, false) + v.ns.units[v.unit];
    if (v instanceof FwElement) return this.render(v);
    if (v instanceof FwError) return v.message;
    if (v instanceof JsonVal) return JSON.stringify(v.v);
    if (v instanceof EnumVal) {
      if (!v.fields) return v.en.hasData ? `${v.en.name}.${v.member.name}` : v.member.name;
      return `${v.en.name}.${v.member.name}(${[...v.fields].map(([k, x]) => `${k}=${this.show(x, true)}`).join(", ")})`;
    }
    if (v instanceof FwFunc) return `function ${v.name}`;
    if (v instanceof Bound) return `function ${v.self.cls.name}.${v.fn.name}`;
    if (v instanceof Native) return `function ${v.name}`;
    if (v instanceof FwClass) return v.name;
    if (v instanceof FwEnum) return v.name;
    if (v instanceof EnumMember) return `${v.en.name}.${v.name}`;
    if (v instanceof Module) return `module ${v.name}`;
    seen = seen || new Set();
    if (seen.has(v)) return "<cycle>";
    seen.add(v);
    try {
      if (Array.isArray(v)) return "[" + v.map(x => this.show(x, true, seen)).join(", ") + "]";
      if (v instanceof Tuple) return "(" + v.items.map(x => this.show(x, true, seen)).join(", ") + (v.items.length === 1 ? ",)" : ")");
      if (v instanceof FwMap) return "{" + [...v.m.values()].map(e => this.show(e.k, true, seen) + ": " + this.show(e.v, true, seen)).join(", ") + "}";
      if (v instanceof FwSet) return "{" + v.items().map(x => this.show(x, true, seen)).join(", ") + "}";
      if (v instanceof ResultVal) return `Result.${v.ok ? "ok" : "error"}(${this.show(v.v, true, seen)})`;
      if (v instanceof Instance) {
        const ts = !nested && findMethod(v.cls, "to_string");
        if (ts) return this.call(new Bound(ts, v), []);
        return `${v.cls.name}(${this.allFields(v.cls).map(f => `${f.name}=${this.show(v.f.get(f.name), true, seen)}`).join(", ")})`;
      }
      if (v instanceof Window) return "desktop.window";
    } finally { seen.delete(v); }
    return String(v);
  }
  typeName(v) {
    if (v === null || v === undefined) return "null";
    switch (typeof v) { case "bigint": return "int"; case "number": return "double"; case "string": return "string"; case "boolean": return "bool"; }
    if (v instanceof FwChar) return "char";
    if (v instanceof Quantity) return `${typeof v.amount === "bigint" ? "int" : "float"}[${v.ns.name}]`;
    if (Array.isArray(v)) return (v.length ? this.typeName(v[0]) : "int") + "[]";
    if (v instanceof Tuple) return "[" + v.items.map(x => this.typeName(x)).join(", ") + "]";
    if (v instanceof FwMap) { const e = [...v.m.values()][0]; return e ? `map<${this.typeName(e.k)},${this.typeName(e.v)}>` : "map"; }
    if (v instanceof FwSet) { const e = v.items()[0]; return e !== undefined ? `set<${this.typeName(e)}>` : "set"; }
    if (v instanceof Instance) return v.cls.name;
    if (v instanceof EnumVal) return v.fields ? `${v.en.name}.${v.member.name}` : v.en.name;
    if (v instanceof FwElement) return v.tag ? "element" : "fragment";
    if (v instanceof ResultVal) return "Result";
    if (v instanceof FwError) return "Error";
    if (v instanceof JsonVal) return "json.value";
    if (v instanceof FwFunc || v instanceof Bound || v instanceof Native) return "function";
    if (v instanceof FwClass) return "class " + v.name;
    if (v instanceof Module) return "module";
    return "value";
  }
  typeStr(t) {
    if (t.opt) return this.typeStr(t.opt) + "?";
    if (t.arr) return this.typeStr(t.arr) + "[]";
    if (t.tuple) return "[" + t.tuple.map(x => this.typeStr(x)).join(", ") + "]";
    if (t.fn) return "function";
    return t.name + (t.args ? "<" + t.args.map(x => this.typeStr(x)).join(", ") + ">" : "");
  }

  /* ---------------- conversions */
  convert(name, v) {
    switch (name) {
      case "int": case "i8": case "i16": case "i32": case "i64": case "u8": case "u16": case "u32": case "u64": {
        if (typeof v === "bigint") return v;
        if (typeof v === "number") { if (!Number.isFinite(v) || Math.abs(v) >= 9223372036854775808) fail("NumericError", "floating to integer cast out of range"); return BigInt(Math.trunc(v)); }
        if (typeof v === "boolean") return v ? 1n : 0n;
        if (v instanceof FwChar) return BigInt(v.cp);
        if (v instanceof EnumVal) return BigInt(v.member.index);
        if (typeof v === "string") { const t = v.trim(); if (!/^[+-]?\d+$/.test(t)) fail("NumericError", "invalid or out-of-range integer string"); const b = BigInt(t); if (b < I64MIN || b > I64MAX) fail("NumericError", "invalid or out-of-range integer string"); return b; }
        if (v === null) fail("CastError", "cannot convert null to int");
        if (isSeq(v) && seqItems(v).length === 1) return this.convert(name, seqItems(v)[0]);
        break;
      }
      case "double": case "float": case "f32": case "f64": {
        if (typeof v === "number") return v;
        if (typeof v === "bigint") return Number(v);
        if (typeof v === "boolean") return v ? 1 : 0;
        if (typeof v === "string") { const t = v.trim(); if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$|^[+-]?(inf|nan)$/i.test(t)) fail("NumericError", "invalid or out-of-range real string"); return /inf/i.test(t) ? (t[0] === "-" ? -Infinity : Infinity) : /nan/i.test(t) ? NaN : Number(t); }
        if (v === null) fail("CastError", "cannot convert null to double");
        if (isSeq(v) && seqItems(v).length === 1) return this.convert(name, seqItems(v)[0]);
        break;
      }
      case "string": return this.show(v, false);
      case "bool": {
        if (typeof v === "boolean") return v;
        if (isNum(v)) return v != 0;     // eslint-disable-line eqeqeq
        if (v === null) return false;
        if (typeof v === "string") { if (v === "true" || v === "1") return true; if (v === "false" || v === "0") return false; fail("ValueError", `invalid bool: "${v}"`); }
        if (isSeq(v)) return seqItems(v).length > 0;
        if (v instanceof FwMap || v instanceof FwSet) return v.size > 0;
        return true;
      }
      case "char": {
        if (v instanceof FwChar) return v;
        if (typeof v === "bigint") return new FwChar(Number(v));
        if (typeof v === "string" && strLen(v) === 1) return new FwChar(v.codePointAt(0));
        break;
      }
    }
    fail("CastError", `cannot convert ${this.typeName(v)} to ${name}`);
  }
  castTo(t, v) {
    if (!t) return v;
    if (t.arr || t.name === "array") {
      const et = t.arr || (t.args && t.args[0]);
      const items = this.toItems(v);
      return et ? items.map(x => this.castTo(et, x)) : items;
    }
    if (t.name === "tuple") { const et = t.args && t.args[0]; return new Tuple(this.toItems(v).map(x => et ? this.castTo(et, x) : x)); }
    if (t.tuple) { const items = this.toItems(v); return new Tuple(items.map((x, i) => this.castTo(t.tuple[i], x))); }
    if (t.name === "set") { const s = new FwSet(); for (const x of this.toItems(v, true)) s.add(this, t.args ? this.castTo(t.args[0], x) : x); return s; }
    if (t.name === "map") {
      if (v instanceof FwMap && !t.args) return v;
      const m = new FwMap();
      const pairs = v instanceof FwMap ? [...v.m.values()].map(e => [e.k, e.v]) : this.toItems(v).map(p => { const it = seqItems(p); if (!it || it.length !== 2) fail("CastError", "map entries must be pairs"); return it; });
      for (const [k, x] of pairs) m.set(this, t.args ? this.castTo(t.args[0], k) : k, t.args ? this.castTo(t.args[1], x) : x);
      return m;
    }
    if (t.opt) return v === null ? null : this.castTo(t.opt, v);
    if (t.name && PRIM_TYPES.has(t.name)) return this.convert(t.name, v);
    return v;
  }
  toItems(v, chars) {
    if (Array.isArray(v)) return v.slice();
    if (v instanceof Tuple) return v.items.slice();
    if (v instanceof FwSet) return v.items();
    if (v instanceof FwMap) return chars ? v.keys() : [...v.m.values()].map(e => new Tuple([e.k, e.v]));
    if (typeof v === "string" && chars) return cps(v).map(c => new FwChar(c.codePointAt(0)));
    return [v];
  }

  jsonDecodeClass(cls, text) {
    let data;
    try { data = typeof text === "string" ? JSON.parse(text) : text instanceof JsonVal ? text.v : text; }
    catch (e) { fail("JsonError", "invalid JSON: " + e.message); }
    return this.fromJson(cls, data);
  }
  fromJson(cls, data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) fail("JsonError", `expected an object for ${cls.name}`);
    const o = new Instance(cls);
    for (const f of this.allFields(cls)) {
      if (f.name in data) o.f.set(f.name, this.jsonToValue(data[f.name], f.type, cls.scope));
      else if (f.def) o.f.set(f.name, this.eval(f.def, cls.scope));
      else if (f.type && f.type.opt) o.f.set(f.name, null);
      else fail("JsonError", `missing field "${f.name}" for ${cls.name}`);
    }
    return o;
  }
  jsonToValue(x, t, scope) {
    if (x === null) return null;
    if (!t) return new JsonVal(x);
    if (t.opt) return this.jsonToValue(x, t.opt, scope);
    if (t.arr) return x.map(i => this.jsonToValue(i, t.arr, scope));
    switch (t.name) {
      case "int": return BigInt(Math.trunc(x));
      case "double": case "float": return Number(x);
      case "string": return String(x);
      case "bool": return !!x;
    }
    const c = this.typeRef(t.name, scope);
    if (c instanceof FwClass) return this.fromJson(c, x);
    if (c instanceof FwEnum) { const m = c.byName.get(x); if (!m) fail("JsonError", `unknown ${c.name} member "${x}"`); return m.value; }
    return new JsonVal(x);
  }
  toJson(v, seen) {
    seen = seen || new Set();
    if (v === null) return null;
    if (typeof v === "bigint") return Number(v);
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
    if (v instanceof FwChar) return String(v);
    if (v instanceof EnumVal) return v.fields ? Object.fromEntries([["member", v.member.name], ...[...v.fields].map(([k, x]) => [k, this.toJson(x, seen)])]) : v.member.name;
    if (v instanceof JsonVal) return v.v;
    if (v instanceof FwElement) return this.render(v);
    if (v instanceof FwError) return { type: v.type, message: v.message };
    if (seen.has(v)) fail("JsonError", "cannot encode a cycle");
    seen.add(v);
    try {
      if (Array.isArray(v) || v instanceof Tuple) return seqItems(v).map(x => this.toJson(x, seen));
      if (v instanceof FwSet) return v.items().map(x => this.toJson(x, seen));
      if (v instanceof FwMap) return Object.fromEntries([...v.m.values()].map(e => [typeof e.k === "string" ? e.k : this.show(e.k, false), this.toJson(e.v, seen)]));
      if (v instanceof ResultVal) return v.ok ? { ok: this.toJson(v.v, seen) } : { error: this.toJson(v.v, seen) };
      if (v instanceof Instance) return Object.fromEntries(this.allFields(v.cls).map(f => [f.name, this.toJson(v.f.get(f.name), seen)]));
    } finally { seen.delete(v); }
    fail("JsonError", `cannot encode ${this.typeName(v)}`);
  }
}
/* ---------------- units (see the units section above) */
Interp.prototype.unitState = function () {
  if (!this._units) this._units = { spaces: [], relations: new Map(), libs: new Map(), equiv: new Map() };
  return this._units;
};
Interp.prototype.declareUnits = function (stmts, module, visible) {
  const U = this.unitState(), own = [];
  const err = (msg, st) => new CompileError(msg, (st && st.line) || this.line || 1, 1);
  for (const st of stmts) if (st.k === "UnitNs") {
    if (own.some(n => n.name === st.name)) throw err(`duplicate unit namespace '${st.name}'`, st);
    const ns = new UnitNs(st.name, module); ns.visible = visible; own.push(ns);
  }
  for (const st of stmts) if (st.k === "UnitDecl") {
    const ns = own.find(n => n.name === st.ns);
    if (!ns) throw err(`unknown unit namespace '${st.ns}'; declare it first: unitns ${st.ns}`, st);
    if (ns.index(st.unit) >= 0) throw err(`duplicate unit '${st.ns}.${st.unit}'`, st);
    const parts = st.factor.split("/");
    let f = decimalRatio(parts[0]);
    if (parts[1]) f = divideRatio(f, decimalRatio(parts[1]));
    if (!(f.value > 0) || !isFinite(f.value)) throw err("a unit's factor must be a positive number", st);
    ns.units.push(st.unit); ns.factors.push(f);
  }
  for (const ns of own) if (!ns.units.length) throw err(`unit namespace '${ns.name}' has no units; add one, such as unit ${ns.name}.base = 1`);
  U.spaces.push(...own);
  // `unitconv 1length.ft = 0.3048metric.length.m`: two namespaces that measure the same thing
  for (const st of stmts) if (st.k === "UnitConv" && st.op === "=") {
    const [a, b] = [st.a, st.b].map(x => {
      const dot = x.ns.indexOf(".");
      const ns = dot < 0 ? own.find(n => n.name === x.ns) || U.spaces.filter(n => n.name === x.ns && n.module !== module).pop()
        : U.spaces.filter(n => n.module === x.ns.slice(0, dot) && n.name === x.ns.slice(dot + 1)).pop();
      if (!ns) throw err(`unknown unit namespace '${x.ns}'; declare it with unitns or import a module that declares it`, st);
      const u = ns.index(x.unit);
      if (u < 0) throw err(`unit namespace '${ns.name}' has no unit '${x.unit}'`, st);
      if (!(x.amount > 0)) throw err("unitconv amounts must be positive", st);
      return { ns, base: x.amount * ns.factors[u].value };
    });
    if (a.ns === b.ns) throw err("unitconv = relates two different namespaces", st);
    if (!own.includes(a.ns) && !own.includes(b.ns)) throw err("unitconv relates namespaces of other modules; relate them in a module that declares one of them", st);
    if (U.equiv.has(a.ns.id + "=" + b.ns.id)) throw err(`unitconv already relates ${st.a.ns} and ${st.b.ns}`, st);
    // b's base = a's base * k; the other way divides by k, as the compiler's methods do
    const k = b.base / a.base;
    U.equiv.set(a.ns.id + "=" + b.ns.id, x => x * k);
    U.equiv.set(b.ns.id + "=" + a.ns.id, x => x / k);
  }
  for (const st of stmts) if (st.k === "UnitConv" && st.op !== "=") {
    const [a, b, c] = [st.a, st.b, st.c].map(x => {
      const ns = own.find(n => n.name === x.ns) || U.spaces.filter(n => n.name === x.ns && (n.visible || n.module !== null)).pop();
      if (!ns) throw err(`unknown unit namespace '${x.ns}'; declare it with unitns or import a module that declares it`, st);
      const u = ns.index(x.unit);
      if (u < 0) throw err(`unit namespace '${ns.name}' has no unit '${x.unit}'`, st);
      if (!(x.amount > 0)) throw err("unitconv amounts must be positive", st);
      return { ns, u, base: x.amount * ns.factors[u].value };
    });
    const k = st.op === "/" ? c.base / (a.base / b.base) : c.base / (a.base * b.base);
    const add = (l, op, r, res, unit, kk, declared) => {
      const key = l.id + op + r.id, old = U.relations.get(key);
      if (old && old.declared && declared) throw err(`unitconv already relates ${l.name} ${op} ${r.name}`, st);
      if (old && !declared) return;
      U.relations.set(key, { ns: res, unit, k: kk, declared });
    };
    add(a.ns, st.op, b.ns, c.ns, c.u, k, true);
    if (st.op === "/") {
      add(c.ns, "*", b.ns, a.ns, a.u, 1 / k); add(b.ns, "*", c.ns, a.ns, a.u, 1 / k); add(a.ns, "/", c.ns, b.ns, b.u, k);
    } else {
      add(b.ns, "*", a.ns, c.ns, c.u, k); add(c.ns, "/", b.ns, a.ns, a.u, 1 / k); add(c.ns, "/", a.ns, b.ns, b.u, 1 / k);
    }
  }
  return own;
};
// `import metric` / `imperial` / `time`: their namespaces become visible under the import's name.
Interp.prototype.loadUnitLibrary = function (name, alias, visible) {
  const U = this.unitState();
  let spaces = U.libs.get(name);
  if (!spaces) {
    for (const need of UNIT_LIBRARIES[name].needs) this.loadUnitLibrary(need, need, false);
    spaces = this.declareUnits(parse(UNIT_LIBRARIES[name].src, name + ".fw"), alias, visible);
    U.libs.set(name, spaces);
  } else if (visible) for (const ns of spaces) { ns.visible = true; ns.module = alias; }
};
// The visible namespace named `name` (qualified by `module`); the program's own come first.
Interp.prototype.unitSpace = function (name, module) {
  const all = this.unitState().spaces.filter(n => n.visible && n.name === name && (!module || n.module === module));
  const own = all.filter(n => n.module === null);
  const found = own.length ? own : all;
  if (found.length > 1)
    fail("CastError", `unit namespace '${name}' is ambiguous: modules ${found[0].module} and ${found[1].module} both declare it; qualify it, such as float[${found[0].module}.${name}]`);
  return found[0] || null;
};
Interp.prototype.typeUnitSpace = function (u) {
  const ns = this.unitSpace(u.ns, u.module);
  if (!ns) fail("CastError", `unknown unit namespace '${u.ns}'; declare it with unitns ${u.ns} or import a module that declares it`);
  return ns;
};
Interp.prototype.expectedUnit = function () {
  let t = this.expectType;
  while (t && (t.opt || t.arr)) t = t.opt || t.arr;
  if (!t || !t.unit) return null;
  return { ns: this.typeUnitSpace(t.unit), real: t.unit.real };
};
// 100m, 0.32km: the namespace comes from the declared type or the only visible one with the unit.
Interp.prototype.quantityLiteral = function (amount, unit, ns, text) {
  const wanted = this.expectedUnit();
  if (!ns && wanted && wanted.ns.index(unit) >= 0) ns = wanted.ns;
  if (!ns) {
    const spaces = this.unitState().spaces;
    let found = spaces.filter(n => n.visible && n.index(unit) >= 0);
    const own = found.filter(n => n.module === null);
    if (own.length) found = own;
    if (!found.length) {
      const hidden = spaces.find(n => n.index(unit) >= 0);
      fail("CastError", `unknown unit '${unit}' after ${String(text).replace(/[A-Za-z_].*$/, "")}` +
        (hidden ? `; import ${hidden.module}, which declares it` : spaces.length ? "" : "; declare units with unitns and unit, such as `unitns length` and `unit length.m = 1`, or import a unit library such as metric"));
    }
    if (found.length > 1) fail("CastError", `unit '${unit}' is ambiguous: ${found[0].name} and ${found[1].name} both have it`);
    ns = found[0];
  }
  const real = typeof amount === "number" || (wanted && wanted.ns === ns && wanted.real);
  return new Quantity(ns, real ? Number(amount) : amount, ns.index(unit));
};
Interp.prototype.unitRatio = function (q, j) {
  const r = divideRatio(q.ns.factors[q.unit], q.ns.factors[j]);
  return r;
};
Interp.prototype.unitReal = function (q, j) {
  if (q.unit === j) return Number(q.amount);
  const r = this.unitRatio(q, j);
  return r.inexact ? Number(q.amount) * r.value : Number(q.amount) * Number(r.num) / Number(r.den);
};
Interp.prototype.unitWhole = function (q, j) {
  if (q.unit === j) return true;
  const r = this.unitRatio(q, j);
  return !r.inexact && r.den === 1n;
};
Interp.prototype.unitExact = function (q, j) {
  if (q.unit === j) return q.amount;
  if (!this.unitWhole(q, j))
    fail("ValueError", `${this.show(q)} is not a whole number of ${q.ns.units[j]}; use float[${q.ns.name}]`);
  return ck(q.amount * this.unitRatio(q, j).num);
};
Interp.prototype.unitConvert = function (q, j) { return new Quantity(q.ns, this.unitReal(q, j), j); };
// `q` in namespace `ns`, unit `j`, through a `unitconv A = B`; null when none relates them.
Interp.prototype.unitAcross = function (q, ns, j) {
  const across = this.unitState().equiv.get(q.ns.id + "=" + ns.id);
  if (across === undefined) return null;
  return new Quantity(ns, across(Number(q.amount) * q.ns.factors[q.unit].value) / ns.factors[j].value, j);
};
// `x in cm`, `x in time.min`: the unit index, or null when the right side is an ordinary value.
Interp.prototype.unitTarget = function (r, scope, q) {
  let name = null, nsName = null;
  if (r.k === "Ident" && !scope.lookup(r.name)) name = r.name;
  else if (r.k === "Member" && r.e.k === "Ident") {
    const v = scope.lookup(r.e.name) ? scope.get(r.e.name) : undefined;
    if (v === undefined || v instanceof Module) { name = r.name; nsName = r.e.name; }
  }
  if (name === null) return null;
  if (nsName === null || nsName === q.ns.name) {
    const j = q.ns.index(name);
    if (j >= 0) return { ns: q.ns, j };
  }
  const candidates = this.unitState().spaces.filter(n => n.visible && n !== q.ns && n.index(name) >= 0 && (!nsName || n.name === nsName));
  const related = candidates.find(n => this.unitState().equiv.has(q.ns.id + "=" + n.id));
  if (related) return { ns: related, j: related.index(name) };     // 1m in ft
  const other = candidates[0];
  if (other) fail("CastError", `cannot convert ${this.typeName(q)} to ${name}: ${name} is a unit of ${other.name}`);
  if (nsName) fail("CastError", `unit namespace '${nsName}' has no unit '${name}'`);
  return null;
};
Interp.prototype.unitBinary = function (op, a, b) {
  const qa = a instanceof Quantity, qb = b instanceof Quantity;
  if (!qa && !qb) return undefined;
  const comparison = ["==", "!=", "<", "<=", ">", ">="].includes(op);
  const verdict = c => op === "==" ? c === 0 : op === "!=" ? c !== 0 : op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : c >= 0;
  const both = `${this.typeName(a)} and ${this.typeName(b)}`;
  if (qa && qb) {
    // 1m + 1ft: the second value in the first one's unit, through `unitconv A = B`
    if (a.ns !== b.ns && (op === "+" || op === "-" || op === "/" || comparison)) {
      const converted = this.unitAcross(b, a.ns, a.unit);
      if (converted) return this.unitBinary(op, new Quantity(a.ns, Number(a.amount), a.unit), converted);
    }
    if (a.ns === b.ns && (op === "+" || op === "-" || op === "/" || comparison)) {
      const j = a.ns.factors[a.unit].value <= b.ns.factors[b.unit].value ? a.unit : b.unit;
      if (op === "/") return this.unitReal(a, j) / this.unitReal(b, j);
      const ints = typeof a.amount === "bigint" && typeof b.amount === "bigint";
      if (op === "+" || op === "-") {
        if (ints) { const x = this.unitExact(a, j), y = this.unitExact(b, j); return new Quantity(a.ns, ck(op === "+" ? x + y : x - y), j); }
        const x = this.unitReal(a, j), y = this.unitReal(b, j);
        return new Quantity(a.ns, op === "+" ? x + y : x - y, j);
      }
      let x, y;
      if (ints && this.unitWhole(a, j) && this.unitWhole(b, j)) { x = this.unitExact(a, j); y = this.unitExact(b, j); }
      else { x = this.unitReal(a, j); y = this.unitReal(b, j); }
      return verdict(x < y ? -1 : x > y ? 1 : 0);
    }
    if (op === "==" || op === "!=") return op === "!=";
    if (op === "*" || op === "/") {
      const R = this.unitState().relations;
      let rel = R.get(a.ns.id + op + b.ns.id), x = a, y = b;
      if (!rel && op === "*" && (rel = R.get(b.ns.id + "*" + a.ns.id))) { x = b; y = a; }
      if (!rel) fail("CastError", `no unitconv relates ${a.ns.name} ${op} ${b.ns.name}; declare one, such as unitconv 1${a.ns.name}.${a.ns.units[0]} ${op} 1${b.ns.name}.${b.ns.units[0]} = 1other.unit`);
      const bx = Number(x.amount) * x.ns.factors[x.unit].value, by = Number(y.amount) * y.ns.factors[y.unit].value;
      return new Quantity(rel.ns, (op === "*" ? bx * by : bx / by) * rel.k / rel.ns.factors[rel.unit].value, rel.unit);
    }
    if (a.ns !== b.ns) fail("CastError", `cannot use ${op} on ${both}: they are in different unit namespaces`);
    fail("CastError", `operator ${op} is not defined for quantities; use + - * / and comparisons`);
  }
  const q = qa ? a : b, n = qa ? b : a;
  if (!isNum(n)) {
    if (op === "==" || op === "!=") return op === "!=";
    fail("CastError", `cannot use ${op} on ${both}`);
  }
  if (op === "*") {
    if (typeof q.amount === "bigint" && typeof n === "bigint") return new Quantity(q.ns, ck(q.amount * n), q.unit);
    return new Quantity(q.ns, Number(q.amount) * Number(n), q.unit);
  }
  if (qa && op === "/") return new Quantity(q.ns, Number(q.amount) / Number(n), q.unit);
  if (qa && op === "//") {
    if (typeof q.amount !== "bigint" || typeof n !== "bigint") fail("CastError", `// divides an int quantity by an int; use / for ${both}`);
    return new Quantity(q.ns, this.arith("//", q.amount, n), q.unit);
  }
  if (op === "+" || op === "-" || comparison)
    fail("CastError", `cannot use ${op} on ${both}; give the number a unit, such as ${typeof n === "number" ? "1.5" : "5"}${q.ns.units[0]}`);
  fail("CastError", `cannot use ${op} on ${both}`);
};

class ExitSig { constructor(code) { this.code = code; } }
class StepLimit {}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* =========================================================================================
 * CSS selectors (subset used by query / query_all / matches / closest)
 * ========================================================================================= */
function parseSelector(sel) {
  const groups = [];
  let i = 0;
  const s = sel.trim();
  if (!s) fail("SelectorError", "empty selector");
  let cur = [], comb = " ";
  const ws = () => { let had = false; while (/\s/.test(s[i] || "")) { i++; had = true; } return had; };
  const ident = () => { const m = /^-?[A-Za-z_][\w-]*/.exec(s.slice(i)); if (!m) fail("SelectorError", `invalid selector '${sel}'`); i += m[0].length; return m[0]; };
  while (i <= s.length) {
    const comp = { tag: null, ids: [], classes: [], attrs: [], pseudos: [] };
    let any = false;
    for (;;) {
      const c = s[i];
      if (c === "*") { i++; comp.tag = "*"; any = true; }
      else if (c && /[A-Za-z_]/.test(c) && !any) { comp.tag = ident().toLowerCase(); any = true; }
      else if (c === "#") { i++; comp.ids.push(ident()); any = true; }
      else if (c === ".") { i++; comp.classes.push(ident()); any = true; }
      else if (c === "[") {
        const j = s.indexOf("]", i); if (j < 0) fail("SelectorError", `invalid selector '${sel}'`);
        const m = /^\s*([\w-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?\s*$/.exec(s.slice(i + 1, j));
        if (!m) fail("SelectorError", `invalid attribute selector in '${sel}'`);
        comp.attrs.push({ name: m[1].toLowerCase(), op: m[2], v: m[3] ?? m[4] ?? m[5] }); i = j + 1; any = true;
      } else if (c === ":") {
        i++; const name = ident(); let arg = null;
        if (s[i] === "(") { let d = 1, j = i + 1; while (j < s.length && d) { if (s[j] === "(") d++; if (s[j] === ")") d--; j++; } arg = s.slice(i + 1, j - 1); i = j; }
        const ok = ["first-child", "last-child", "only-child", "nth-child", "nth-last-child", "first-of-type", "last-of-type", "only-of-type", "nth-of-type", "empty", "not", "checked", "disabled", "enabled"];
        if (!ok.includes(name)) fail("SelectorError", `unsupported pseudo-class ':${name}'`);
        comp.pseudos.push({ name, arg: name === "not" ? parseSelector(arg) : arg }); any = true;
      } else break;
    }
    if (!any) fail("SelectorError", `invalid selector '${sel}'`);
    cur.push({ comb, comp });
    const hadWs = ws();
    if (i >= s.length) { groups.push(cur); break; }
    const c = s[i];
    if (c === ",") { i++; ws(); groups.push(cur); cur = []; comb = " "; continue; }
    if (c === ">" || c === "+" || c === "~") { comb = c; i++; ws(); continue; }
    if (hadWs) { comb = " "; continue; }
    fail("SelectorError", `invalid selector '${sel}'`);
  }
  return groups;
}
function nth(arg, pos) {
  const a = arg.replace(/\s/g, "").toLowerCase();
  if (a === "odd") return pos % 2 === 1;
  if (a === "even") return pos % 2 === 0;
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(a);
  if (!m) return pos === parseInt(a, 10);
  const A = m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : parseInt(m[1], 10), B = m[2] ? parseInt(m[2], 10) : 0;
  if (A === 0) return pos === B;
  const n = (pos - B) / A;
  return Number.isInteger(n) && n >= 0;
}
function matchCompound(I, el, c) {
  if (c.tag && c.tag !== "*" && el.tag.toLowerCase() !== c.tag) return false;
  const attr = n => { const v = el.attrs.get(n); return v === undefined || v === false || v === null ? null : v === true ? "" : I.show(v, false); };
  for (const id of c.ids) if (attr("id") !== id) return false;
  const classes = (attr("class") || "").split(/\s+/);
  for (const cl of c.classes) if (!classes.includes(cl)) return false;
  for (const a of c.attrs) {
    const v = attr(a.name);
    if (v === null) return false;
    if (!a.op) continue;
    const ok = { "=": v === a.v, "~=": v.split(/\s+/).includes(a.v), "^=": v.startsWith(a.v), "$=": v.endsWith(a.v), "*=": v.includes(a.v), "|=": v === a.v || v.startsWith(a.v + "-") }[a.op];
    if (!ok) return false;
  }
  for (const p of c.pseudos) {
    const parent = I.namedParent(el);
    const sibs = parent ? I.namedChildren(parent) : [el];
    const idx = sibs.indexOf(el), same = sibs.filter(x => x.tag === el.tag), tidx = same.indexOf(el);
    let ok;
    switch (p.name) {
      case "first-child": ok = idx === 0; break;
      case "last-child": ok = idx === sibs.length - 1; break;
      case "only-child": ok = sibs.length === 1; break;
      case "nth-child": ok = nth(p.arg, idx + 1); break;
      case "nth-last-child": ok = nth(p.arg, sibs.length - idx); break;
      case "first-of-type": ok = tidx === 0; break;
      case "last-of-type": ok = tidx === same.length - 1; break;
      case "only-of-type": ok = same.length === 1; break;
      case "nth-of-type": ok = nth(p.arg, tidx + 1); break;
      case "empty": ok = el.children.length === 0; break;
      case "not": ok = !p.arg.some(g => matchComplex(I, el, g, g.length - 1)); break;
      case "checked": ok = attr("checked") !== null || attr("selected") !== null; break;
      case "disabled": ok = attr("disabled") !== null; break;
      case "enabled": ok = attr("disabled") === null; break;
    }
    if (!ok) return false;
  }
  return true;
}
function matchComplex(I, el, parts, k) {
  if (!matchCompound(I, el, parts[k].comp)) return false;
  if (k === 0) return true;
  const comb = parts[k].comb;
  if (comb === " ") { for (let p = I.namedParent(el); p; p = I.namedParent(p)) if (matchComplex(I, p, parts, k - 1)) return true; return false; }
  if (comb === ">") { const p = I.namedParent(el); return !!p && matchComplex(I, p, parts, k - 1); }
  const parent = I.namedParent(el); if (!parent) return false;
  const sibs = I.namedChildren(parent), idx = sibs.indexOf(el);
  if (comb === "+") return idx > 0 && matchComplex(I, sibs[idx - 1], parts, k - 1);
  for (let j = idx - 1; j >= 0; j--) if (matchComplex(I, sibs[j], parts, k - 1)) return true;
  return false;
}

/* =========================================================================================
 * builtins, methods of built-in values, and modules
 * ========================================================================================= */
Interp.prototype.installBuiltins = function () {
  const I = this, B = new Map();
  const N = (name, fn, typed) => { const n = new Native(name, fn); if (typed) n.typed = typed; B.set(name, n); return n; };
  N("print", args => { I.out(args.map(a => I.show(a, false)).join(" ")); return null; });
  N("input", args => { if (args.length) I.out(I.show(args[0], false)); return I.stdin && I.stdin.length ? I.stdin.shift() : null; });
  N("len", ([v]) => { const p = I.props(v, "length"); if (p === undefined) fail("RuntimeError", `len() of ${I.typeName(v)}`); return p; });
  N("typeof", ([v]) => I.typeName(v));
  // type(x) names a value's type (a quantity's number type); unit(x) and unitns(x) a quantity's unit and namespace
  N("type", ([v]) => v instanceof Quantity ? (typeof v.amount === "bigint" ? "int" : "float") : I.typeName(v));
  N("unit", ([v]) => { if (!(v instanceof Quantity)) fail("CastError", `unit(x) needs a quantity such as 15s, got ${I.typeName(v)}`); return v.ns.units[v.unit]; });
  N("unitns", ([v]) => { if (!(v instanceof Quantity)) fail("CastError", `unitns(x) needs a quantity such as 15s, got ${I.typeName(v)}`); return v.ns.name; });
  for (const t of ["int", "double", "float", "string", "bool", "char", "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64"]) N(t, ([v]) => I.convert(t, v));
  N("array", ([v]) => v === undefined ? [] : I.toItems(v), (targs, [v]) => v === undefined ? [] : I.castTo({ name: "array", args: targs }, v));
  N("tuple", ([v]) => v === undefined ? new Tuple([]) : new Tuple(I.toItems(v)), (targs, [v]) => I.castTo({ name: "tuple", args: targs }, v === undefined ? [] : v));
  N("set", ([v]) => { const s = new FwSet(); if (v !== undefined) for (const x of I.toItems(v, true)) s.add(I, x); return s; }, (targs, [v]) => I.castTo({ name: "set", args: targs }, v === undefined ? [] : v));
  N("map", ([v]) => v === undefined ? new FwMap() : I.castTo({ name: "map" }, v), (targs, [v]) => I.castTo({ name: "map", args: targs }, v === undefined ? [] : v));
  N("weak", ([v]) => v);
  B.set("Result", new Module("Result", new Map([
    ["ok", new Native("Result.ok", ([v]) => new ResultVal(true, v === undefined ? null : v))],
    ["error", new Native("Result.error", ([v]) => new ResultVal(false, v === undefined ? null : v))],
  ])));
  for (const t of ERROR_TYPES) N(t, ([m]) => new FwError(t, m === undefined ? "" : I.show(m, false)));
  this.builtins = B;
  this.modules = makeModules(this);
};

const str = (I, v) => I.show(v, false);
Interp.prototype.props = function (v, name) {
  const I = this;
  if (typeof v === "string") { if (name === "length" || name === "len") return BigInt(strLen(v)); return undefined; }
  if (Array.isArray(v)) { if (name === "length") return BigInt(v.length); return undefined; }
  if (v instanceof Tuple) { if (name === "length") return BigInt(v.items.length); return undefined; }
  if (v instanceof FwMap || v instanceof FwSet) { if (name === "length") return BigInt(v.size); return undefined; }
  if (v instanceof JsonVal) { if (name === "length") return BigInt(Array.isArray(v.v) ? v.v.length : v.v && typeof v.v === "object" ? Object.keys(v.v).length : 0); return undefined; }
  if (v instanceof FwElement) {
    switch (name) {
      case "tag": return v.tag;
      case "text_content": return I.elText(v);
      case "inner_html": return v.children.map(c => typeof c === "string" ? escHtml(c) : I.render(c)).join("");
      case "outer_html": return I.render(v);
      case "id": return v.attrs.has("id") ? str(I, v.attrs.get("id")) : "";
      case "class_name": return v.attrs.has("class") ? str(I, v.attrs.get("class")) : "";
      case "children": return I.namedChildren(v);
      case "attributes": { const m = new FwMap(); for (const [k, x] of v.attrs) if (!(x instanceof FwFunc || x instanceof Bound || x instanceof Native)) m.set(I, k, x === true ? "" : str(I, x)); return m; }
      case "parent": return v.parent || null;
      case "next_sibling": case "previous_sibling": {
        const p = I.namedParent(v); if (!p) return null;
        const sibs = I.namedChildren(p), i = sibs.indexOf(v);
        return sibs[name === "next_sibling" ? i + 1 : i - 1] || null;
      }
    }
    return undefined;
  }
  if (v instanceof Window) { if (name === "title") return v.title; return undefined; }
  return undefined;
};
Interp.prototype.methodOf = function (v, name) {
  const I = this;
  const fn = f => typeof f === "function" ? f : null;
  const callF = (f, ...a) => I.call(f, a);
  const bool = (f, ...a) => { const r = I.call(f, a); if (typeof r !== "boolean") fail("CastError", "callback must return bool"); return r; };
  if (typeof v === "string") {
    const s = v;
    const sub = x => x instanceof FwChar ? String(x) : x;
    return fn({
      upper: () => s.toUpperCase(), lower: () => s.toLowerCase(),
      trim: () => s.trim(), trim_start: () => s.trimStart(), trim_end: () => s.trimEnd(),
      split: ([sep]) => sep === undefined ? s.split(/\s+/).filter(Boolean) : s.split(sub(sep)),
      lines: () => s.split(/\r\n|\r|\n/).filter((x, i, a) => !(i === a.length - 1 && x === "")),
      chars: () => cps(s).map(c => new FwChar(c.codePointAt(0))),
      find: ([x]) => { const i = s.indexOf(sub(x)); return BigInt(i < 0 ? -1 : strLen(s.slice(0, i))); },
      find_last: ([x]) => { const i = s.lastIndexOf(sub(x)); return BigInt(i < 0 ? -1 : strLen(s.slice(0, i))); },
      contains: ([x]) => s.includes(sub(x)), starts_with: ([x]) => s.startsWith(sub(x)), ends_with: ([x]) => s.endsWith(sub(x)),
      count: ([x]) => { x = sub(x); if (!x) return BigInt(strLen(s) + 1); return BigInt(s.split(x).length - 1); },
      replace: ([a, b]) => s.split(sub(a)).join(sub(b)),
      pad_start: ([w, f]) => { const n = Number(w) - strLen(s); return n > 0 ? (sub(f) || " ").repeat(n).slice(0, n) + s : s; },
      pad_end: ([w, f]) => { const n = Number(w) - strLen(s); return n > 0 ? s + (sub(f) || " ").repeat(n).slice(0, n) : s; },
      reverse: () => cps(s).reverse().join(""), repeat: ([n]) => s.repeat(Number(n)), is_empty: () => s.length === 0,
      slice: ([a, b]) => I.slice(s, Number(a), b === undefined ? undefined : Number(b)),
      join: ([seq]) => I.toItems(seq).map(x => str(I, x)).join(s),
      to_string: () => s,
    }[name]);
  }
  if (Array.isArray(v) || v instanceof Tuple) {
    const items = seqItems(v), isArr = Array.isArray(v);
    const mut = f => (...a) => { if (!isArr) fail("RuntimeError", `tuples do not support ${name}`); if (v.frozen) fail("ValueError", "cannot modify a frozen array"); return f(...a); };
    const m = {
      slice: ([a, b]) => I.slice(v, Number(a), b === undefined ? undefined : Number(b)),
      index_of: ([x]) => BigInt(items.findIndex(y => I.eq(y, x))),
      contains: ([x]) => items.some(y => I.eq(y, x)),
      copy: () => isArr ? items.slice() : new Tuple(items.slice()),
      join: ([sep]) => items.map(x => str(I, x)).join(sep === undefined ? "" : sep),
      map: ([f]) => items.map(x => callF(f, x)),
      filter: ([f]) => items.filter(x => bool(f, x)),
      reduce: ([init, f]) => items.reduce((acc, x) => callF(f, acc, x), init),
      any: ([f]) => items.some(x => bool(f, x)),
      all: ([f]) => items.every(x => bool(f, x)),
      each: ([f]) => { items.forEach(x => callF(f, x)); return null; },
      push: mut(([x]) => { items.push(x); return null; }),
      pop: mut(() => { if (!items.length) fail("IndexError", "pop from an empty array"); return items.pop(); }),
      insert: mut(([i, x]) => { const k = Number(i); if (k < 0 || k > items.length) fail("IndexError", "index out of bounds"); items.splice(k, 0, x); return null; }),
      remove_at: mut(([i]) => items.splice(I.idxNum(i, items.length), 1)[0]),
      remove: mut(([x]) => { const k = items.findIndex(y => I.eq(y, x)); if (k < 0) return false; items.splice(k, 1); return true; }),
      clear: mut(() => { items.length = 0; return null; }),
      extend: mut(([o]) => { items.push(...I.toItems(o)); return null; }),
      reverse: mut(() => { items.reverse(); return null; }),
      sort: mut(([less]) => {
        const sorted = items.map((x, i) => [x, i]).sort((a, b) => {
          if (less) { if (bool(less, a[0], b[0])) return -1; if (bool(less, b[0], a[0])) return 1; return a[1] - b[1]; }
          return I.cmp(a[0], b[0]) || a[1] - b[1];
        });
        sorted.forEach(([x], i) => { items[i] = x; });
        return null;
      }),
      freeze: () => { v.frozen = true; return v; },
      is_frozen: () => !!v.frozen,
      to_string: () => I.show(v, false),
    };
    return fn(m[name]);
  }
  if (v instanceof FwMap) return fn({
    keys: () => v.keys(), values: () => v.values(),
    remove: ([k]) => v.remove(I, k), contains: ([k]) => v.has(I, k), has: ([k]) => v.has(I, k),
    get: ([k, d]) => { const e = v.get(I, k); return e ? e.v : d === undefined ? null : d; },
    clear: () => { if (v.frozen) fail("ValueError", "cannot modify a frozen map"); v.m.clear(); return null; },
    items: () => [...v.m.values()].map(e => new Tuple([e.k, e.v])),
    copy: () => { const m = new FwMap(); for (const e of v.m.values()) m.set(I, e.k, e.v); return m; },
    freeze: () => { v.frozen = true; return v; }, is_frozen: () => v.frozen,
  }[name]);
  if (v instanceof FwSet) {
    const mk = arr => { const s = new FwSet(); arr.forEach(x => s.add(I, x)); return s; };
    return fn({
      add: ([x]) => v.add(I, x), remove: ([x]) => v.remove(I, x), contains: ([x]) => v.has(I, x),
      clear: () => { if (v.frozen) fail("ValueError", "cannot modify a frozen set"); v.m.m.clear(); return null; },
      items: () => v.items(),
      union: ([o]) => mk([...v.items(), ...o.items()]),
      intersection: ([o]) => mk(v.items().filter(x => o.has(I, x))),
      difference: ([o]) => mk(v.items().filter(x => !o.has(I, x))),
      is_subset: ([o]) => v.items().every(x => o.has(I, x)),
      copy: () => mk(v.items()), freeze: () => { v.frozen = true; v.m.frozen = true; return v; }, is_frozen: () => v.frozen,
    }[name]);
  }
  if (v instanceof FwElement) {
    const named = () => { if (!v.tag) fail("RuntimeError", "fragments have no attributes"); };
    const tokens = () => (v.attrs.has("class") ? str(I, v.attrs.get("class")) : "").split(/\s+/).filter(Boolean);
    const setTokens = t => { if (t.length) v.attrs.set("class", t.join(" ")); else v.attrs.delete("class"); };
    const checkTok = t => { if (!t || /\s/.test(t)) fail("ValueError", "invalid class token"); };
    return fn({
      query: ([s]) => I.query(v, s, false), query_all: ([s]) => I.query(v, s, true),
      get_by_id: ([id]) => I.descendants(v, []).find(n => n.attrs.get("id") === id) || null,
      matches: ([s]) => parseSelector(s).some(g => matchComplex(I, v, g, g.length - 1)),
      closest: ([s]) => { const gs = parseSelector(s); for (let n = v; n; n = I.namedParent(n)) if (n.tag && gs.some(g => matchComplex(I, n, g, g.length - 1))) return n; return null; },
      get_text: () => I.elText(v), set_text: ([t]) => { I.elSetText(v, t); return null; },
      render: () => I.render(v),
      get_attribute: ([n]) => v.attrs.has(n) ? (v.attrs.get(n) === true ? "" : str(I, v.attrs.get(n))) : null,
      has_attribute: ([n]) => v.attrs.has(n),
      set_attribute: ([n, x]) => { named(); v.attrs.set(n, str(I, x)); return null; },
      remove_attribute: ([n]) => v.attrs.delete(n),
      append: ([x]) => { if (VOID_TAGS.has(v.tag)) fail("RuntimeError", `<${v.tag}> cannot have children`); I.insertValue(v, x); return null; },
      prepend: ([x]) => { const tmp = new FwElement(""); I.insertValue(tmp, x); tmp.children.forEach(c => { if (c instanceof FwElement) c.parent = v; }); v.children.unshift(...tmp.children); return null; },
      remove_child: ([n]) => { const rm = el => { const i = el.children.indexOf(n); if (i >= 0) { el.children.splice(i, 1); n.parent = null; return true; } return el.children.some(c => c instanceof FwElement && !c.tag && rm(c)); }; return rm(v); },
      clear: () => { v.children = []; return null; },
      clone: ([deep]) => cloneEl(v, deep !== false),
      has_class: ([t]) => tokens().includes(t),
      add_class: ([t]) => { named(); checkTok(t); const ts = tokens(); if (ts.includes(t)) return false; ts.push(t); setTokens(ts); return true; },
      remove_class: ([t]) => { named(); const ts = tokens(); const i = ts.indexOf(t); if (i < 0) return false; ts.splice(i, 1); setTokens(ts); return true; },
      toggle_class: ([t]) => { named(); checkTok(t); const ts = tokens(); const i = ts.indexOf(t); if (i < 0) ts.push(t); else ts.splice(i, 1); setTokens(ts); return i < 0; },
      attributes: () => I.props(v, "attributes"), children: () => I.namedChildren(v),
    }[name]);
  }
  if (v instanceof JsonVal) return fn({ to_string: () => JSON.stringify(v.v) }[name]);
  if (v instanceof FwChar) return fn({ upper: () => new FwChar(String(v).toUpperCase().codePointAt(0)), lower: () => new FwChar(String(v).toLowerCase().codePointAt(0)), is_digit: () => /\d/.test(String(v)), is_letter: () => /\p{L}/u.test(String(v)), is_space: () => /\s/.test(String(v)) }[name]);
  if (v instanceof Window) return fn({
    load: ([t]) => { v.tree = t; I.onWindow && I.onWindow(v); return null; },
    run: () => { I.onWindow && I.onWindow(v); I.windows.includes(v) || I.windows.push(v); return null; },
    set_title: ([t]) => { v.title = t; I.onWindow && I.onWindow(v); return null; },
    eval: () => null, bind: () => fail("DesktopError", "JavaScript bindings are not available in flywheel.js"),
    close: () => null,
  }[name]);
  return null;
};
function cloneEl(el, deep) {
  const c = new FwElement(el.tag);
  for (const [k, v] of el.attrs) c.attrs.set(k, v);
  if (deep) c.children = el.children.map(x => { if (typeof x === "string") return x; const y = cloneEl(x, true); y.parent = c; return y; });
  return c;
}

function makeModules(I) {
  const mod = (name, obj) => new Module(name, new Map(Object.entries(obj).map(([k, v]) => [k, typeof v === "function" ? new Native(name + "." + k, v) : v])));
  const num = x => Number(x);
  const keepType = (vals, f) => vals.every(x => typeof x === "bigint") ? f(vals) : Number(f(vals.map(Number)));
  const math = mod("math", {
    PI: Math.PI, TAU: Math.PI * 2, E: Math.E, INF: Infinity, NAN: NaN,
    sqrt: ([x]) => Math.sqrt(num(x)), sin: ([x]) => Math.sin(num(x)), cos: ([x]) => Math.cos(num(x)), tan: ([x]) => Math.tan(num(x)),
    asin: ([x]) => Math.asin(num(x)), acos: ([x]) => Math.acos(num(x)), atan: ([x]) => Math.atan(num(x)),
    atan2: ([y, x]) => Math.atan2(num(y), num(x)), hypot: ([x, y]) => Math.hypot(num(x), num(y)),
    exp: ([x]) => Math.exp(num(x)), log: ([x, b]) => b === undefined ? Math.log(num(x)) : Math.log(num(x)) / Math.log(num(b)),
    log10: ([x]) => Math.log10(num(x)), log2: ([x]) => Math.log2(num(x)), pow: ([a, b]) => Math.pow(num(a), num(b)),
    floor: ([x]) => Math.floor(num(x)), ceil: ([x]) => Math.ceil(num(x)), trunc: ([x]) => Math.trunc(num(x)),
    round: ([x]) => { const v = num(x); return Math.sign(v) * Math.round(Math.abs(v)); },
    is_nan: ([x]) => Number.isNaN(num(x)), is_finite: ([x]) => Number.isFinite(num(x)),
    abs: ([x]) => typeof x === "bigint" ? ck(x < 0n ? -x : x) : Math.abs(x),
    min: args => keepType(args, a => a.reduce((m, x) => x < m ? x : m)),
    max: args => keepType(args, a => a.reduce((m, x) => x > m ? x : m)),
    clamp: ([x, lo, hi]) => keepType([x, lo, hi], ([a, b, c]) => a < b ? b : a > c ? c : a),
    random: () => I.rng(),
    random_int: ([lo, hi]) => lo + BigInt(Math.floor(I.rng() * Number(hi - lo + 1n))),
    seed: ([n]) => { I.rng = mulberry32(Number(BigInt.asUintN(32, n))); return null; },
  });
  const collections = mod("collections", {
    range: ([a, b]) => { let lo = 0n, hi = a; if (b !== undefined) { lo = a; hi = b; } const out = []; if (hi - lo > 10000000n) fail("NumericError", "range too large"); for (let i = lo; i < hi; i++) out.push(i); return out; },
  });
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const pad = (n, w) => String(n).padStart(w || 2, "0");
  const strftime = (secs, pat, local) => {
    const d = new Date(num(secs) * 1000);
    const g = local ? { Y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), H: d.getHours(), M: d.getMinutes(), S: d.getSeconds(), w: d.getDay() }
      : { Y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), H: d.getUTCHours(), M: d.getUTCMinutes(), S: d.getUTCSeconds(), w: d.getUTCDay() };
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return pat.replace(/%([YmdHMSaAbBjyZ%])/g, (_, c) => ({ Y: g.Y, m: pad(g.m), d: pad(g.d), H: pad(g.H), M: pad(g.M), S: pad(g.S), a: days[g.w].slice(0, 3), A: days[g.w], b: months[g.m - 1].slice(0, 3), B: months[g.m - 1], y: pad(g.Y % 100), Z: local ? "" : "UTC", j: pad(Math.floor((d - new Date(Date.UTC(g.Y, 0, 1))) / 864e5) + 1, 3), "%": "%" }[c]));
  };
  // a duration in seconds: a number, or a time quantity (500ms, delay) converted to seconds
  const seconds = (v, what) => {
    if (!(v instanceof Quantity)) return num(v);
    if (v.ns.name !== "time" || v.ns.index("s") < 0) fail("TypeError", `${what} expects seconds or a time quantity, not ${I.typeName(v)}`);
    return I.unitReal(v, v.ns.index("s"));
  };
  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const wait = secs => { const end = clock() + Math.min(Math.max(secs, 0), 2) * 1000; while (clock() < end) { /* busy wait (capped) */ } return null; };
  const time = mod("time", {
    now: () => Date.now() / 1000,
    monotonic: () => ((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) / 1000,
    sleep: ([s]) => wait(seconds(s, "time.sleep")), delay: ([s]) => wait(seconds(s, "time.delay")),
    sleep_ms: ([ms]) => wait(ms instanceof Quantity ? seconds(ms, "time.sleep_ms") : num(ms) / 1000),
    millis: () => BigInt(Math.floor(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0))),
    elapsed: ([start]) => ((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) / 1000 - num(start),
    unix: () => BigInt(Math.floor(Date.now() / 1000)),
    today: () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },
    clock: () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; },
    timestamp: () => new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    format: ([s, p]) => strftime(s, p || "%Y-%m-%dT%H:%M:%SZ", false),
    format_local: ([s, p]) => strftime(s, p || "%Y-%m-%d %H:%M:%S", true),
    from_date: ([y, mo, d, h, mi, s]) => Date.UTC(num(y), num(mo) - 1, num(d), num(h || 0n), num(mi || 0n), 0) / 1000 + num(s || 0),
  });
  const re = (p, flags) => { try { return new RegExp(p, "u" + (flags || "")); } catch (e) { fail("RegexError", e.message); } };
  const regex = mod("regex", {
    matches: ([p, t]) => re("^(?:" + p + ")$").test(t), contains: ([p, t]) => re(p).test(t),
    find: ([p, t]) => { const m = re(p).exec(t); return m ? m[0] : null; },
    find_all: ([p, t]) => [...t.matchAll(re(p, "g"))].map(m => m[0]),
    groups: ([p, t]) => { const m = re(p).exec(t); return m ? m.slice(1).map(x => x ?? "") : null; },
    replace: ([p, t, r]) => t.replace(re(p, "g"), r),
    split: ([p, t]) => t.split(re(p)),
  });
  const json = mod("json", {
    parse: ([t]) => { try { return new JsonVal(JSON.parse(t)); } catch (e) { fail("JsonError", "invalid JSON: " + e.message); } },
    encode: ([v, indent]) => JSON.stringify(I.toJson(v), null, indent ? Number(indent) : undefined),
    stringify: ([v]) => JSON.stringify(sortKeys(v instanceof JsonVal ? v.v : I.toJson(v))),
    loads: ([t]) => { try { return new JsonVal(JSON.parse(t)); } catch (e) { fail("JsonError", "invalid JSON: " + e.message); } },
    dumps: ([v, indent]) => JSON.stringify(I.toJson(v), null, indent ? Number(indent) : undefined),
    load: ([path]) => {
      const text = hostFile(I, "read", path);
      try { return new JsonVal(JSON.parse(text)); } catch (e) { fail("JsonError", "invalid JSON: " + e.message); }
    },
    dump: ([v, path, indent]) => { hostFile(I, "write", path, JSON.stringify(I.toJson(v), null, indent ? Number(indent) : undefined)); return null; },
    get: ([v, k]) => I.index(v, k), at: ([v, i]) => I.index(v, i),
    has: ([v, k]) => !!(v.v && typeof v.v === "object" && k in v.v),
    length: ([v]) => I.props(v, "length"),
    keys: ([v]) => Object.keys(v.v || {}),
    items: ([v]) => (Array.isArray(v.v) ? v.v : Object.values(v.v || {})).map(x => new JsonVal(x)),
    is_null: ([v]) => v.v === null,
    kind: ([v]) => v.v === null ? "null" : Array.isArray(v.v) ? "array" : typeof v.v === "object" ? "object" : typeof v.v,
    as_string: ([v]) => { if (typeof v.v !== "string") fail("JsonError", "not a string"); return v.v; },
    as_int: ([v]) => { if (typeof v.v !== "number") fail("JsonError", "not a number"); return BigInt(Math.trunc(v.v)); },
    as_double: ([v]) => { if (typeof v.v !== "number") fail("JsonError", "not a number"); return v.v; },
    as_bool: ([v]) => { if (typeof v.v !== "boolean") fail("JsonError", "not a bool"); return v.v; },
  });
  const decode = (t, text) => {
    let data;
    try { data = text instanceof JsonVal ? text.v : JSON.parse(text); } catch (e) { fail("JsonError", "invalid JSON: " + e.message); }
    return t ? I.jsonToValue(data, t, I.global) : new JsonVal(data);
  };
  const dec = new Native("json.decode", ([text]) => decode(I.expectType, text));
  dec.typed = (targs, [text]) => decode(targs[0], text);
  json.members.set("decode", dec);
  const b64 = s => typeof btoa === "function" ? btoa(String.fromCharCode(...new TextEncoder().encode(s))) : Buffer.from(s).toString("base64");
  const unb64 = s => { try { return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))); } catch (e) { fail("ValueError", "invalid base64"); } };
  const encoding = mod("encoding", {
    base64_encode: ([s]) => b64(s), base64_decode: ([s]) => unb64(s),
    base64url_encode: ([s]) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    base64url_decode: ([s]) => unb64(s.replace(/-/g, "+").replace(/_/g, "/")),
    hex_encode: ([s]) => [...new TextEncoder().encode(s)].map(b => b.toString(16).padStart(2, "0")).join(""),
    hex_decode: ([s]) => new TextDecoder().decode(Uint8Array.from(s.match(/../g) || [], h => parseInt(h, 16))),
    url_encode: ([s]) => encodeURIComponent(s), url_decode: ([s]) => decodeURIComponent(s.replace(/\+/g, " ")),
  });
  const uuid = mod("uuid", {
    v4: () => { const b = new Uint8Array(16); (typeof crypto !== "undefined" ? crypto : require("crypto").webcrypto).getRandomValues(b); b[6] = b[6] & 0x0f | 0x40; b[8] = b[8] & 0x3f | 0x80; const h = [...b].map(x => x.toString(16).padStart(2, "0")).join(""); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; },
  });
  const testing = mod("testing", {
    assert: ([c, m]) => { if (c !== true) fail("AssertionError", m || "assertion failed"); return null; },
    assert_equal: ([a, b, m]) => { if (!I.eq(a, b)) fail("AssertionError", m || `expected ${I.show(b, true)}, got ${I.show(a, true)}`); return null; },
    fail: ([m]) => fail("AssertionError", m || "failed"),
  });
  const html = mod("html", {
    render: ([t]) => I.render(t),
    query: ([t, s]) => I.query(t, s, false), query_all: ([t, s]) => I.query(t, s, true),
    get_by_id: ([t, id]) => I.descendants(t, []).find(n => n.attrs.get("id") === id) || null,
    parse: ([t]) => parseHtml(I, t),
  });
  const response = (body, status, type) => { const r = new Instance(RESPONSE); r.f.set("status", status === undefined ? 200n : status); r.f.set("body", body); r.f.set("headers", (() => { const m = new FwMap(); m.set(I, "content-type", type); return m; })()); return r; };
  const web = mod("web", {
    serve: ([route, handler, port]) => { I.routes.push({ route, handler }); return `http://127.0.0.1:${port === undefined ? 8000 : port}${route}`; },
    route: ([method, route, handler, port]) => { if (method === "GET" || method === "*") I.routes.push({ route, handler }); return `http://127.0.0.1:${port === undefined ? 8000 : port}${route}`; },
    html: ([b, s]) => response(b instanceof FwElement ? I.render(b) : str(I, b), s, "text/html; charset=utf-8"),
    text: ([b, s]) => response(str(I, b), s, "text/plain; charset=utf-8"),
    json: ([b, s]) => response(b instanceof JsonVal ? JSON.stringify(b.v) : str(I, b), s, "application/json"),
    redirect: ([u, s]) => response("", s === undefined ? 302n : s, "text/plain"),
    wait: () => null, workers: () => null, static: () => fail("NetworkError", "web.static is not available in flywheel.js"),
    get: () => fail("HttpError", "network requests are not available in flywheel.js"),
    post: () => fail("HttpError", "network requests are not available in flywheel.js"),
    fetch: () => fail("HttpError", "network requests are not available in flywheel.js"),
  });
  const RESPONSE = new FwClass("web.response");
  RESPONSE.ownFields = ["status", "body", "headers"].map(name => ({ name }));
  const desktop = mod("desktop", {
    window: ([title]) => { const w = new Window(title === undefined ? "Flywheel" : title); return w; },
  });
  const os = mod("os", { args: () => I.argv.slice(), env: () => "", exit: ([c]) => { throw new ExitSig(Number(c || 0n)); } });
  // Runs another file in a fresh interpreter and returns its top-level return value as json.value.
  const runFile = (file, args, quiet) => {
    const code = hostFile(I, "read", file, undefined, "ProcessError");
    const child = new Interp(Object.assign({}, I.opts, { args: (args || []).map(String), stdin: undefined }));
    const t = Date.now();
    const r = child.run(code, String(file).split(/[\/\\]/).pop());
    if (r.status !== 0 && !(r.value !== undefined && r.value !== null)) fail("ProcessError", `${file} exited with status ${r.status}`);
    r.ms = Date.now() - t;
    r.interp = child;
    return r;
  };
  const retJson = r => r.value === null || r.value === undefined ? new JsonVal(null) : r.value instanceof FwElement ? new JsonVal(r.interp.render(r.value)) : new JsonVal(I.toJson(r.value));
  const flywheel = mod("flywheel", {
    run: ([file, args]) => retJson(runFile(file, args)),
    debug: ([file, args]) => {
      const r = runFile(file, args), j = retJson(r);
      I.errOut(`[debug] ${r.value === null || r.value === undefined ? "no return value" : "returned " + JSON.stringify(j.v)} in ${r.ms} ms`);
      return j;
    },
    export: ([file, output, args]) => {
      const r = runFile(file, args);
      if (r.value === null || r.value === undefined) fail("ProcessError", `${file} returned no value`);
      const text = typeof r.value === "string" ? r.value : r.value instanceof FwElement ? r.interp.render(r.value) : JSON.stringify(I.toJson(r.value));
      hostFile(I, "write", output, text);
      return retJson(r);
    },
    desktop: () => fail("ProcessError", "flywheel.desktop is not available in flywheel.js; use the playground's app pane or install Flywheel"),
    serve: () => fail("ProcessError", "flywheel.serve is not available in flywheel.js; install Flywheel to serve pages"),
  });
  return { math, collections, time, regex, json, encoding, uuid, testing, html, svg: html, web, desktop, os, flywheel };
}
// Lenient HTML reader for html.parse: lower-cased names, implicit closes, raw text elements.
function parseHtml(I, text) {
  const root = new FwElement(""), stack = [root];
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", copy: "\u00a9", reg: "\u00ae", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", laquo: "\u00ab", raquo: "\u00bb", trade: "\u2122" };
  const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : named[e.toLowerCase()] ?? m);
  const closesP = new Set("address article aside blockquote div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hr main nav ol p pre section table ul".split(" "));
  const implicit = { li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr", "td", "th"], td: ["td", "th"], th: ["td", "th"], option: ["option"], p: ["p"] };
  const top = () => stack[stack.length - 1];
  const add = n => { const p = top(); if (n instanceof FwElement) n.parent = p; p.children.push(n); };
  const dropWs = new Set(["html", "head", "table", "tbody", "thead", "tr", "ul", "ol", "dl", "select"]);
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("<!--", i)) { const e = text.indexOf("-->", i + 4); i = e < 0 ? text.length : e + 3; continue; }
    if (text[i] === "<" && (text[i + 1] === "!" || text[i + 1] === "?")) { const e = text.indexOf(">", i); i = e < 0 ? text.length : e + 1; continue; }
    if (text[i] === "<" && text[i + 1] === "/") {
      const m = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(text.slice(i));
      if (m) {
        const name = m[1].toLowerCase();
        for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === name) { stack.length = k; break; }
        i += m[0].length; continue;
      }
    }
    if (text[i] === "<" && /[a-zA-Z]/.test(text[i + 1] || "")) {
      const m = /^<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/.exec(text.slice(i));
      if (m) {
        const tag = m[1].toLowerCase(), el = new FwElement(tag);
        for (const a of m[2].matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) el.attrs.set(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ""));
        if (implicit[tag]) while (stack.length > 1 && implicit[tag].includes(top().tag)) stack.pop();
        if (closesP.has(tag)) while (stack.length > 1 && top().tag === "p") stack.pop();
        add(el); i += m[0].length;
        if (VOID_TAGS.has(tag) || m[3]) continue;
        if (["script", "style", "textarea", "title"].includes(tag)) {
          const e = text.toLowerCase().indexOf("</" + tag, i);
          const raw = text.slice(i, e < 0 ? text.length : e);
          if (raw) el.children.push(tag === "textarea" || tag === "title" ? decode(raw) : raw);
          i = e < 0 ? text.length : text.indexOf(">", e) + 1; continue;
        }
        stack.push(el); continue;
      }
    }
    const next = text.indexOf("<", i + 1);
    const chunk = text.slice(i, next < 0 ? text.length : next);
    if (!(dropWs.has(top().tag) && /^\s*$/.test(chunk))) add(decode(chunk));
    i = next < 0 ? text.length : next;
  }
  return root;
}
// File access for json.load / json.dump / flywheel.* : only where Node's fs exists.
function hostFile(I, mode, path, text, errType) {
  let fs = null;
  try { if (typeof process !== "undefined" && process.versions && process.versions.node && typeof require === "function") fs = require("fs"); } catch (e) { fs = null; }
  const type = errType || "FileError";
  if (!fs) fail(type, `files are not available in the browser (flywheel.js): '${path}'`);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) fail(type, `URLs are not available in flywheel.js: '${path}'`);
  try { return mode === "read" ? fs.readFileSync(path, "utf8") : (fs.writeFileSync(path, text), null); }
  catch (e) { fail(type, `${mode === "read" ? "cannot read" : "cannot write"} '${path}': ${e.code || e.message}`); }
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
  return v;
}

/* =========================================================================================
 * public API
 * ========================================================================================= */
function run(source, opts) {
  opts = opts || {};
  const I = new Interp(opts);
  if (opts.stdin) I.stdin = opts.stdin.slice();
  const r = I.run(source, opts.name);
  r.interp = I;
  // an app: a top-level returned element, a served "/" route, or a desktop window
  if (r.status === 0 && !(r.value instanceof FwElement)) {
    const root = I.routes.find(x => x.route === "/") || I.routes[0];
    if (root) {
      try {
        const v = I.call(root.handler, root.handler instanceof FwFunc && root.handler.params.length ? [requestFor(I, root.route)] : []);
        if (v instanceof FwElement) r.value = v;
        else if (v instanceof Instance && v.cls.name === "web.response") r.html = str(I, v.f.get("body"));
        else if (typeof v === "string") r.text = v;
        r.served = root.route;
      } catch (e) {
        if (e instanceof FwThrow) { I.errOut(`Flywheel runtime error: ${I.describeError(e.value)}`); r.status = 1; } else throw e;
      }
    } else if (I.windows.length && I.windows[0].tree) { r.value = I.windows[0].tree; r.window = I.windows[0]; }
  }
  return r;
}
function requestFor(I, path) {
  const c = new FwClass("web.request");
  c.ownFields = ["method", "path", "query", "headers", "body", "params", "form"].map(name => ({ name }));
  const r = new Instance(c);
  r.f.set("method", "GET"); r.f.set("path", path); r.f.set("query", ""); r.f.set("headers", new FwMap());
  r.f.set("body", ""); r.f.set("params", new FwMap()); r.f.set("form", new FwMap());
  return r;
}

class Session {
  constructor(opts) { this.I = new Interp(opts || {}); }
  exec(source) { return this.I.run(source, "repl", true); }
}

const api = { run, parse, Session, Interp, FwElement, FwFunc, Bound, Native, CompileError, version: "2.2 (beta-2) flywheel.js" };
root.Flywheel = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this);
