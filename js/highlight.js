/* Flywheel syntax highlighting with the grammar from the VS Code extension
 * (github.com/fwlang/vscode-flywheel, syntaxes/flywheel.tmLanguage.json).
 *
 * A small TextMate engine: begin/end/match rules, includes, captures, contentName and
 * back-references in end patterns, run line by line like an editor does. The grammar's
 * regexes only use features that JavaScript's RegExp shares with Oniguruma.
 */
(function (root) {
"use strict";

let grammar = null;
const compiled = new Map();

function re(src) {
  let r = compiled.get(src);
  if (!r) {
    try { r = new RegExp(src, "dgu"); }
    catch (e) { try { r = new RegExp(src, "dg"); } catch (e2) { r = /(?!)/dg; } }
    compiled.set(src, r);
  }
  return r;
}

// Flatten a rule's patterns, resolving includes.
function patternsOf(rule, base) {
  if (rule._flat) return rule._flat;
  const out = [], seen = new Set();
  const add = list => {
    for (const p of list || []) {
      if (p.include) {
        let target = null;
        if (p.include === "$self" || p.include === "$base") target = { patterns: grammar.patterns };
        else if (p.include[0] === "#") target = grammar.repository[p.include.slice(1)];
        if (!target || seen.has(target)) continue;
        seen.add(target);
        if (target.match || target.begin) out.push(target); else add(target.patterns);
      } else if (p.match || p.begin) out.push(p);
      else add(p.patterns);
    }
  };
  add(rule.patterns);
  rule._flat = out;
  return out;
}

const escRe = s => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

function tokenizeLine(line, stack, emit) {
  let pos = 0, guard = 0, lastZero = null;
  while (pos <= line.length && guard++ < 2000) {
    const top = stack[stack.length - 1];
    const pats = patternsOf(top.rule);
    let best = null, bestRule = null, bestIsEnd = false;
    if (top.end) {
      const r = top.end; r.lastIndex = pos;
      const m = r.exec(line);
      if (m) { best = m; bestIsEnd = true; }
    }
    for (const p of pats) {
      const r = re(p.match || p.begin); r.lastIndex = pos;
      const m = r.exec(line);
      if (!m) continue;
      if (!best || m.index < best.index) { best = m; bestRule = p; bestIsEnd = false; }
    }
    const scopes = stack.map(s => s.scope).concat(top.content ? [top.content] : []).filter(Boolean);
    if (!best) { if (pos < line.length) emit(line.slice(pos), scopes); break; }
    if (best.index > pos) emit(line.slice(pos, best.index), scopes);
    const end = best.index + best[0].length;
    if (bestIsEnd) {
      const outer = stack.map(s => s.scope).filter(Boolean);
      emitCaptures(line, best, top.rule.endCaptures || top.rule.captures, outer, emit);
      if (stack.length > 1) stack.pop();
      pos = end;
      continue;
    }
    if (bestRule.match) {
      const sc = scopes.concat(bestRule.name ? [bestRule.name] : []);
      emitCaptures(line, best, bestRule.captures, sc, emit);
      if (best[0].length === 0) { if (pos < line.length) emit(line[pos], scopes); pos++; } else pos = end;
      continue;
    }
    // begin (a zero-width begin at the same spot twice would loop: step over a character)
    if (best[0].length === 0) {
      if (lastZero && lastZero.rule === bestRule && lastZero.pos === pos) { if (pos < line.length) emit(line[pos], scopes); pos++; lastZero = null; continue; }
      lastZero = { rule: bestRule, pos };
    }
    const frame = { rule: bestRule, scope: bestRule.name || null, content: bestRule.contentName || null };
    let endSrc = bestRule.end || "(?!)";
    endSrc = endSrc.replace(/\\(\d)/g, (_, n) => escRe(best[+n] || ""));
    frame.end = new RegExp(endSrc, "dgu");
    const sc = scopes.concat(frame.scope ? [frame.scope] : []);
    emitCaptures(line, best, bestRule.beginCaptures || bestRule.captures, sc, emit);
    if (stack.length > 60) break;
    stack.push(frame);
    pos = end;
  }
}

function emitCaptures(line, m, caps, scopes, emit) {
  if (!m[0].length) return;
  if (!caps) { emit(m[0], scopes); return; }
  // paint group 0 then overlay captured groups (non-overlapping, outermost first)
  const start = m.index, len = m[0].length;
  const paint = new Array(len).fill(null).map(() => scopes.slice());
  if (caps["0"] && caps["0"].name) for (let i = 0; i < len; i++) paint[i].push(caps["0"].name);
  for (let g = 1; g < m.length; g++) {
    if (!caps[g] || !caps[g].name || !m.indices[g]) continue;
    const [a, b] = m.indices[g];
    for (let i = a; i < b; i++) paint[i - start].push(caps[g].name);
  }
  let run = 0;
  for (let i = 1; i <= len; i++) {
    if (i === len || paint[i].join(" ") !== paint[run].join(" ")) { emit(line.slice(start + run, start + i), paint[run]); run = i; }
  }
}

// scope -> css class, most specific wins
const CLASSES = [
  ["comment", "c"], ["invalid", "err"],
  ["constant.character.escape", "esc"], ["constant.character.entity", "esc"], ["constant.other.format-spec", "spec"],
  ["punctuation.section.interpolation", "interp"], ["punctuation.definition.string", "s"],
  ["string", "s"],
  ["constant.numeric", "n"], ["constant.language", "lit"], ["constant.other.color", "n"],
  ["keyword.control.import", "kw"], ["keyword.control", "kw"], ["keyword.operator.logical", "kw"],
  ["keyword.operator", "op"], ["keyword.other", "kw"],
  ["storage.type.function", "kw"], ["storage.type.class", "kw"], ["storage.type", "kw"], ["storage.modifier", "kw"],
  ["entity.name.function", "fn"], ["entity.name.type", "ty"], ["support.type.property-name", "attr"],
  ["support.type", "ty"], ["support.function", "fn"],
  ["entity.name.tag", "tag"], ["entity.other.attribute-name", "attr"], ["entity.name.namespace", "ns"],
  ["variable.language", "self"], ["punctuation.definition.tag", "tagp"],
  ["meta.embedded", ""], ["variable", ""], ["punctuation", "p"],
];
function classFor(scopes) {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    for (const [prefix, cls] of CLASSES) if (s === prefix || s.startsWith(prefix + ".")) return cls;
  }
  for (let i = scopes.length - 1; i >= 0; i--) if (/^string|^comment/.test(scopes[i])) return scopes[i][0] === "s" ? "s" : "c";
  return "";
}

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function highlight(code) {
  if (!grammar) return esc(code);
  const stack = [{ rule: { patterns: grammar.patterns }, scope: grammar.scopeName, end: null }];
  const lines = code.split("\n");
  let html = "";
  lines.forEach((line, i) => {
    tokenizeLine(line, stack, (text, scopes) => {
      const cls = classFor(scopes);
      html += cls ? `<span class="t-${cls}">${esc(text)}</span>` : esc(text);
    });
    if (i < lines.length - 1) html += "\n";
  });
  return html;
}

const api = {
  load(g) { grammar = g; compiled.clear(); },
  async fetch(url) { const r = await fetch(url); api.load(await r.json()); return api; },
  highlight,
  get ready() { return !!grammar; },
};
root.FwHighlight = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
