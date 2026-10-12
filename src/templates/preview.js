'use strict';
/** Publisher-facing preview page: one tab per template, desktop/mobile width toggle. */
const { esc } = require('./shared');
const { list, renderAll } = require('./index');

function renderPreviewPage(newsletter, opts = {}) {
  const html = renderAll(newsletter, opts);
  const templates = list();
  const frames = templates
    .map((t, i) => `<section class="pane" id="pane-${t.id}"${i ? ' hidden' : ''}>
<p class="desc">${esc(t.description)} <span class="size">${(Buffer.byteLength(html[t.id]) / 1024).toFixed(0)} KB</span></p>
<div class="device"><iframe title="${esc(t.name)} preview" srcdoc="${esc(html[t.id])}"></iframe></div>
</section>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Newsletter Preview</title>
<style>
  :root{--bg:#f3f4f6;--panel:#ffffff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#2457d6;}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111318;--panel:#1b1e25;--text:#f3f4f6;--muted:#9ca3af;--line:#2c313b;--accent:#7aa2ff;}}
  :root[data-theme="dark"]{--bg:#111318;--panel:#1b1e25;--text:#f3f4f6;--muted:#9ca3af;--line:#2c313b;--accent:#7aa2ff;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}
  header{padding:20px 16px 0;max-width:1100px;margin:0 auto;}
  h1{font-size:20px;margin:0 0 4px;}
  .meta{color:var(--muted);font-size:13px;margin:0 0 14px;overflow-wrap:anywhere;}
  .bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:10px;}
  .tabs,.widths{display:flex;flex-wrap:wrap;gap:6px;}
  button{font:inherit;font-size:14px;border:1px solid var(--line);background:var(--panel);color:var(--text);padding:6px 12px;border-radius:999px;cursor:pointer;}
  button[aria-selected="true"]{background:var(--accent);border-color:var(--accent);color:#fff;}
  main{max-width:1100px;margin:0 auto;padding:12px 16px 40px;}
  .desc{color:var(--muted);font-size:13px;margin:4px 0 12px;}
  .size{margin-left:6px;padding:1px 6px;border:1px solid var(--line);border-radius:4px;font-size:12px;}
  .device{margin:0 auto;width:100%;max-width:680px;transition:max-width .2s;}
  body.mobile .device{max-width:390px;}
  iframe{display:block;width:100%;height:80vh;min-height:600px;border:1px solid var(--line);border-radius:8px;background:#fff;}
</style>
</head>
<body>
<header>
  <h1>${esc(newsletter.publication.name)}: ${templates.length} newsletter formats</h1>
  <p class="meta">Subject: <b>${esc(newsletter.subject)}</b><br>Preheader: ${esc(newsletter.preheader)}</p>
  <div class="bar">
    <div class="tabs" role="tablist">
      ${templates.map((t, i) => `<button role="tab" data-id="${t.id}" aria-selected="${i === 0}">${esc(t.name)}</button>`).join('\n      ')}
    </div>
    <div class="widths">
      <button data-w="desktop" aria-selected="true">Desktop</button>
      <button data-w="mobile" aria-selected="false">Mobile</button>
    </div>
  </div>
</header>
<main>
${frames}
</main>
<script>
  document.querySelectorAll('[role=tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('[role=tab]').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      document.querySelectorAll('.pane').forEach(function (p) { p.hidden = p.id !== 'pane-' + b.dataset.id; });
    });
  });
  document.querySelectorAll('[data-w]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('[data-w]').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      document.body.classList.toggle('mobile', b.dataset.w === 'mobile');
    });
  });
</script>
</body>
</html>
`;
}

module.exports = { renderPreviewPage };
