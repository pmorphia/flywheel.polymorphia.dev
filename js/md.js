/* Minimal Markdown renderer for the docs and lessons: headings (with ids), paragraphs, lists,
 * fenced code (Flywheel blocks are highlighted and get a "Try it" button), tables, blockquotes,
 * and inline code, emphasis and links. Links to sibling .md files are rewritten by `link`. */
(function (root) {
"use strict";
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = s => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/`/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

function inline(s, opts) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img alt="${alt}" src="${src}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const h = opts.link ? opts.link(href.replace(/&amp;/g, "&")) : href;
    const ext = /^https?:/.test(h);
    return `<a href="${esc(h)}"${ext ? ' target="_blank" rel="noopener"' : ""}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

function render(md, opts) {
  opts = opts || {};
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let html = "", i = 0, para = [];
  const toc = [];
  const flush = () => { if (para.length) { html += `<p>${inline(para.join(" "), opts)}</p>`; para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if ((m = /^```(\w*)\s*(.*)$/.exec(line))) {
      flush();
      const lang = m[1], info = m[2], buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const code = buf.join("\n");
      if (lang === "flywheel" || lang === "fw") {
        const hl = root.FwHighlight && root.FwHighlight.ready ? root.FwHighlight.highlight(code) : esc(code);
        const id = opts.codes ? opts.codes.push(code) - 1 : 0;
        const label = /\bnorun\b/.test(info) ? "" : `<button class="try" type="button" data-code="${id}">${opts.tryLabel || "Try it ▶"}</button>`;
        html += `<pre class="fw">${label}<code>${hl}</code></pre>`;
      } else html += `<pre><code>${esc(code)}</code></pre>`;
      continue;
    }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      flush();
      const lvl = m[1].length, text = m[2], id = slug(text);
      if (lvl > 1) toc.push({ lvl, text, id });
      html += `<h${lvl} id="${id}">${inline(text, opts)}</h${lvl}>`;
      i++; continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flush();
      const cells = l => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, "|"));
      const head = cells(line);
      i += 2;
      let t = "<table><thead><tr>" + head.map(c => `<th>${inline(c, opts)}</th>`).join("") + "</tr></thead><tbody>";
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { t += "<tr>" + cells(lines[i]).map(c => `<td>${inline(c, opts)}</td>`).join("") + "</tr>"; i++; }
      html += t + "</tbody></table>";
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      flush();
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const l = lines[i];
        if (/^\s*([-*]|\d+\.)\s+/.test(l) && !/^\s{4,}/.test(l)) items.push(l.replace(/^\s*([-*]|\d+\.)\s+/, ""));
        else items[items.length - 1] += " " + l.trim();
        i++;
      }
      html += (ordered ? "<ol>" : "<ul>") + items.map(it => `<li>${inline(it, opts)}</li>`).join("") + (ordered ? "</ol>" : "</ul>");
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      html += `<blockquote>${inline(buf.join(" "), opts)}</blockquote>`;
      continue;
    }
    if (/^:::\s*note/.test(line)) {
      flush(); i++;
      const buf = [];
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html += `<div class="note">${render(buf.join("\n"), opts).html}</div>`;
      continue;
    }
    if (/^\s*$/.test(line)) { flush(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush();
  return { html, toc };
}

root.FwMarkdown = { render, slug };
})(typeof self !== "undefined" ? self : globalThis);
