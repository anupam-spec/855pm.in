'use strict';
/** HTML for the publisher site: upload page, newsletter dashboard, errors. */
const { escapeHtml: esc } = require('../util');
const { formatDate } = require('../templates/shared');

const STYLE = `
:root{--ink:#16181d;--muted:#5f6673;--line:#e2e4e9;--bg:#f6f6f3;--card:#fff;--accent:#c8102e;--accent-ink:#fff;--ok:#1e7b3c;--warn:#8a5a00;--warn-bg:#fff6e0}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
a{color:inherit}
header.top{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--line);background:var(--card)}
.brand{font:700 18px/1 Georgia,serif;text-decoration:none;letter-spacing:.3px}
.brand b{color:var(--accent)}
main{max-width:1080px;margin:0 auto;padding:32px 16px 64px}
h1{font:700 34px/1.15 Georgia,serif;margin:0 0 10px}
.lede{color:var(--muted);font-size:17px;margin:0 0 28px;max-width:640px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px}
.tabs{display:flex;gap:8px;margin-bottom:20px}
.tab{flex:1;padding:14px;border:1.5px solid var(--line);border-radius:10px;background:var(--card);cursor:pointer;text-align:left;font:inherit}
.tab strong{display:block;font-size:15px}
.tab span{color:var(--muted);font-size:13px}
.tab[aria-selected=true]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
label{display:block;font-weight:600;margin:0 0 6px}
.hint{color:var(--muted);font-size:13px;margin:6px 0 0}
input[type=url],input[type=text],input[type=email]{width:100%;padding:12px 14px;border:1.5px solid var(--line);border-radius:8px;font:inherit;background:#fff}
input:focus{outline:none;border-color:var(--ink)}
.drop{display:block;border:1.5px dashed #b9bdc6;border-radius:10px;padding:28px;text-align:center;cursor:pointer;background:#fbfbfa}
.drop.over{border-color:var(--ink);background:#f0f0ec}
.drop input{display:none}
.drop .file{font-weight:600}
.row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px}
details{margin-top:20px}
summary{cursor:pointer;font-weight:600}
.btn{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border:0;border-radius:8px;background:var(--ink);color:#fff;font:600 15px/1 inherit;font-family:inherit;cursor:pointer;text-decoration:none}
.btn:disabled{opacity:.55;cursor:wait}
.btn.ghost{background:transparent;color:var(--ink);border:1.5px solid var(--line)}
.btn.small{padding:8px 12px;font-size:13px}
.actions{margin-top:24px;display:flex;gap:12px;align-items:center}
.msg{margin-top:14px;padding:10px 14px;border-radius:8px;font-size:14px;display:none}
.msg.show{display:block}
.msg.err{background:#fdecec;color:#9b1c1c}
.msg.ok{background:#e8f5ec;color:var(--ok)}
.msg.warn{background:var(--warn-bg);color:var(--warn)}
.steps{list-style:none;padding:0;margin:16px 0 0;display:none}
.steps.show{display:block}
.steps li{padding:4px 0;color:var(--muted)}
.steps li.on{color:var(--ink);font-weight:600}
.steps li.done{color:var(--ok)}
.steps li::before{content:"○ ";}
.steps li.on::before{content:"◐ "}
.steps li.done::before{content:"✓ "}
.dash{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:start}
.formats{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px}
.fmt.own{border-style:dashed}
.ownform{display:none;margin:-4px 0 16px}
.ownform.show{display:block}
.fmt{padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--card);cursor:pointer;text-align:left;font:inherit}
.fmt strong{display:block;font-size:14px}
.fmt span{display:block;color:var(--muted);font-size:12px;line-height:1.35;margin-top:2px}
.fmt[aria-pressed=true]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.frame{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.frame .bar{display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid var(--line);align-items:center}
.frame .bar .sp{flex:1}
.seg{display:inline-flex;border:1.5px solid var(--line);border-radius:8px;overflow:hidden}
.seg button{border:0;background:#fff;padding:7px 12px;font:600 13px/1 inherit;font-family:inherit;cursor:pointer}
.seg button[aria-pressed=true]{background:var(--ink);color:#fff}
iframe{display:block;width:100%;height:900px;border:0;background:#f3f4f6}
.side .card{margin-bottom:16px}
.side h2{font:700 17px/1.2 Georgia,serif;margin:0 0 12px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px;margin:0}
.kv dt{color:var(--muted)}
.kv dd{margin:0;word-break:break-word}
.inline{display:flex;gap:8px}
.inline input{flex:1;min-width:0}
.note{font-size:13px;color:var(--muted);margin:10px 0 0}
.note code{font-size:12px;background:#f0f0ec;padding:1px 4px;border-radius:4px}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;background:#e8f5ec;color:var(--ok);font-size:12px;font-weight:600}
@media (max-width:1000px){.formats{grid-template-columns:repeat(3,1fr)}}
@media (max-width:820px){.formats{grid-template-columns:1fr 1fr}.dash{grid-template-columns:1fr}.row{grid-template-columns:1fr}iframe{height:700px}h1{font-size:28px}.tabs{flex-direction:column}}
`;

const layout = (title, body, script = '') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="top"><a class="brand" href="/">Newsletter builder</a><a href="/format" class="hint">Our RSS format</a></header>
<main>${body}</main>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;

const READ_FILE_JS = `
function readFile(file, asDataUrl) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read ' + file.name));
    asDataUrl ? r.readAsDataURL(file) : r.readAsText(file);
  });
}
function showMsg(el, kind, text) { el.className = 'msg show ' + kind; el.textContent = text; }
function dropZone(zone, onFile) {
  const input = zone.querySelector('input[type=file]');
  input.addEventListener('change', () => input.files[0] && onFile(input.files[0]));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]); });
}
async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: 'Unexpected response (' + res.status + ')' }));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { data });
  return data;
}`;

function home() {
  const body = `
<h1>Turn your stories into a live newsletter</h1>
<p class="lede">Give us your website or upload your RSS feed. We build an email newsletter with your logo on top, and the stories refresh every time a reader opens it.</p>
<form class="card" id="f" novalidate>
  <div class="tabs" role="tablist">
    <button type="button" class="tab" role="tab" aria-selected="true" data-mode="url"><strong>Website or feed URL</strong><span>We find your stories, or scrape them if there's no feed</span></button>
    <button type="button" class="tab" role="tab" aria-selected="false" data-mode="rss"><strong>Upload RSS file</strong><span>An RSS 2.0 or Atom file in <a href="/format" target="_blank">our format</a></span></button>
  </div>
  <div data-pane="url">
    <label for="url">Your website or RSS feed address</label>
    <input id="url" type="url" inputmode="url" placeholder="https://www.yourpublication.com" autocomplete="url">
    <p class="hint">A homepage, a section page or a feed URL all work.</p>
  </div>
  <div data-pane="rss" hidden>
    <label>RSS file</label>
    <label class="drop" id="rssDrop"><input type="file" accept=".xml,.rss,.atom,application/rss+xml,application/atom+xml,text/xml,application/xml,application/json"><span class="file">Choose an RSS file</span><br><span class="hint">or drop it here</span></label>
    <p class="hint">Each item needs a title and link; a description, pubDate, category and <code>media:content</code> image make it richer. <a href="/format" download="sample-feed.xml">Download a sample</a>.</p>
  </div>
  <details>
    <summary>Masthead (optional)</summary>
    <div class="row">
      <div>
        <label for="name">Publication name</label>
        <input id="name" type="text" placeholder="Taken from your site if left blank">
      </div>
      <div>
        <label>Logo</label>
        <label class="drop" id="logoDrop" style="padding:14px"><input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"><span class="file">Upload logo</span><br><span class="hint">PNG or SVG works best. We use your site's logo otherwise.</span></label>
      </div>
    </div>
  </details>
  <div class="actions"><button class="btn" id="go" type="submit">Build my newsletter</button></div>
  <ol class="steps" id="steps">
    <li>Reading your stories</li>
    <li>Picking up your logo</li>
    <li>Building the newsletter</li>
  </ol>
  <div class="msg" id="msg" role="status"></div>
</form>`;
  const script = `${READ_FILE_JS}
let mode = 'url', rssText = '', logoData = '';
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  mode = t.dataset.mode;
  document.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', x === t));
  document.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== mode));
}));
const msg = document.getElementById('msg');
dropZone(document.getElementById('rssDrop'), async (file) => {
  rssText = await readFile(file, false);
  document.querySelector('#rssDrop .file').textContent = file.name;
});
dropZone(document.getElementById('logoDrop'), async (file) => {
  logoData = await readFile(file, true);
  document.querySelector('#logoDrop .file').textContent = file.name;
});
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.className = 'msg';
  const body = { name: document.getElementById('name').value, logo: logoData || undefined };
  if (mode === 'url') {
    const u = document.getElementById('url').value.trim();
    if (!u) return showMsg(msg, 'err', 'Enter your website or feed address.');
    body.url = u;
  } else {
    if (!rssText) return showMsg(msg, 'err', 'Choose an RSS file to upload.');
    body.rss = rssText;
  }
  const go = document.getElementById('go');
  go.disabled = true; go.textContent = 'Building…';
  const steps = [...document.querySelectorAll('#steps li')];
  document.getElementById('steps').classList.add('show');
  let i = 0;
  const tick = () => steps.forEach((s, j) => (s.className = j < i ? 'done' : j === i ? 'on' : ''));
  tick();
  const timer = setInterval(() => { if (i < steps.length - 1) { i++; tick(); } }, mode === 'url' ? 6000 : 700);
  try {
    const res = await postJson('/api/newsletters', body);
    clearInterval(timer); i = steps.length; tick();
    location.href = res.next + (res.logoError ? '?logo=bad' : '');
  } catch (err) {
    clearInterval(timer);
    document.getElementById('steps').classList.remove('show');
    showMsg(msg, 'err', err.message);
    go.disabled = false; go.textContent = 'Build my newsletter';
  }
});`;
  return layout('Build your newsletter', body, script);
}

function dashboard({ rec, sending, formats, custom, format }) {
  const pub = rec.publication;
  const sourceLabel = rec.kind === 'rss' ? 'Uploaded RSS file' : { feed: 'Your RSS feed', scrape: 'Scraped from your site', sitemap: 'Your news sitemap', llm: 'Read from your site' }[rec.source] || rec.source;
  const sendNote = sending.configured
    ? `<p class="note">Sent from <code>${esc(sending.from)}</code>. Gmail shows the live version once that sender is registered with Google, or allow-listed under Gmail Settings › General › Dynamic email › Developer settings. Other inboxes show the regular version.</p>`
    : `<div class="msg show warn">Sending isn't switched on yet: the site needs an email provider. Until then, download the email below and open it, or preview it here.</div>`;
  const body = `
<h1>${esc(pub.name)}</h1>
<p class="lede">Your newsletter is built. Pick a format below. Each one shows your ${rec.logo ? 'logo' : 'name'} on top with the time it was last built, has Google Ad Manager ad slots, and the stories update each time a reader opens it.</p>
<div class="msg ${rec.logoError || !rec.logo ? 'show warn' : ''}" id="logoWarn">${rec.logoError ? esc(rec.logoError) : !rec.logo ? 'We could not find a usable logo on your site, so the masthead shows your name. Upload a logo below.' : ''}</div>
<h2 style="font:700 17px/1.2 Georgia,serif;margin:0 0 10px">Pick a format</h2>
<div class="formats" role="group" aria-label="Format">
${formats.map((f) => `<button type="button" class="fmt" aria-pressed="${f.id === format}" data-format="${f.id}"><strong>${esc(f.name)}</strong><span>${esc(f.description)}</span></button>`).join('\n')}
<button type="button" class="fmt own" aria-pressed="${format === 'custom'}" data-format="custom" data-ready="${rec.custom ? 1 : 0}"><strong>${esc(custom.name)}</strong><span>${rec.custom ? `${rec.custom.stories} stories from your newsletter, kept in your design.` : 'Give us the link to your existing newsletter and we keep its design.'}</span></button>
</div>
<form class="card ownform${format === 'custom' ? ' show' : ''}" id="ownForm" novalidate>
  <label for="ownUrl">Link to your existing newsletter</label>
  <div class="inline"><input id="ownUrl" type="url" placeholder="The &quot;View in browser&quot; link of one issue" value="${esc(rec.custom?.url || '')}"><button class="btn" id="ownBtn" type="submit">Use my newsletter</button></div>
  <p class="hint">We keep your newsletter's look and swap its stories for your latest ones, with the Updated time and an ad slot on top.</p>
  <div class="msg" id="ownMsg" role="status"></div>
</form>
<div class="dash">
  <section class="frame">
    <div class="bar">
      <div class="seg" role="group" aria-label="Version">
        <button type="button" aria-pressed="true" data-view="preview">Email</button>
        <button type="button" aria-pressed="false" data-view="amp">Live (AMP)</button>
      </div>
      <span class="sp"></span>
      <button type="button" class="btn ghost small" id="reload">Rebuild now</button>
    </div>
    <iframe id="pv" src="/n/${rec.id}/preview?format=${format}" title="Newsletter preview"></iframe>
  </section>
  <aside class="side">
    <div class="card">
      <h2>Send it to your Gmail</h2>
      <form id="sendForm" class="inline" novalidate>
        <input id="email" type="email" placeholder="you@gmail.com" autocomplete="email" required>
        <button class="btn" id="sendBtn" type="submit"${sending.configured ? '' : ' disabled'}>Send</button>
      </form>
      <div class="msg" id="sendMsg" role="status"></div>
      ${sendNote}
      <p class="note"><a href="/n/${rec.id}/email.eml">Download the email (.eml)</a></p>
    </div>
    <div class="card">
      <h2>Masthead</h2>
      <label class="drop" id="logoDrop" style="padding:14px"><input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"><span class="file">${rec.logo ? 'Replace logo' : 'Upload logo'}</span></label>
      <form id="nameForm" class="inline" style="margin-top:12px">
        <input id="pubName" type="text" value="${esc(pub.name)}" aria-label="Publication name">
        <button class="btn ghost small" type="submit">Save</button>
      </form>
      <div class="msg" id="mastMsg" role="status"></div>
    </div>
    <div class="card">
      <h2>Stories</h2>
      <dl class="kv">
        <dt>Source</dt><dd>${esc(sourceLabel)}</dd>
        ${rec.input ? `<dt>From</dt><dd><a href="${esc(rec.input)}" target="_blank" rel="noopener">${esc(rec.input)}</a></dd>` : ''}
        <dt>Stories</dt><dd>${rec.articles.length}</dd>
        <dt>Last built</dt><dd>${esc(formatDate(rec.builtAt))}</dd>
        <dt>Feed</dt><dd><a href="/n/${rec.id}/feed.xml" target="_blank">feed.xml</a></dd>
      </dl>
      ${rec.kind === 'rss'
        ? `<label class="drop" id="rssDrop" style="padding:14px;margin-top:14px"><input type="file" accept=".xml,.rss,.atom,application/rss+xml,application/atom+xml,text/xml,application/xml"><span class="file">Upload a newer RSS file</span></label>
      <p class="note">Emails already sent pick up the new stories the next time they're opened.</p>`
        : `<p class="note">We re-check your site at most every few minutes when a reader opens the email.</p>`}
      ${rec.lastRefreshError ? `<div class="msg show warn">Last refresh failed: ${esc(rec.lastRefreshError)}</div>` : ''}
      <div class="msg" id="rssMsg" role="status"></div>
    </div>
  </aside>
</div>`;
  const script = `${READ_FILE_JS}
const id = ${JSON.stringify(rec.id)};
const pv = document.getElementById('pv');
let view = 'preview', fmt = ${JSON.stringify(format)};
const show = () => { pv.src = '/n/' + id + '/' + view + '?format=' + fmt; };
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  view = b.dataset.view; show();
}));
const ownForm = document.getElementById('ownForm');
ownForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = document.getElementById('ownMsg'), btn = document.getElementById('ownBtn');
  const u = document.getElementById('ownUrl').value.trim();
  if (!u) return showMsg(m, 'err', 'Paste the link to your newsletter.');
  btn.disabled = true; btn.textContent = 'Reading it…';
  try {
    const r = await postJson('/api/newsletters/' + id, { customUrl: u });
    showMsg(m, 'ok', 'Found ' + r.stories + ' stories in your newsletter.');
    setTimeout(() => location.reload(), 700);
  } catch (err) { showMsg(m, 'err', err.message); btn.disabled = false; btn.textContent = 'Use my newsletter'; }
});
document.querySelectorAll('.fmt').forEach((b) => b.addEventListener('click', async () => {
  if (b.dataset.format === 'custom') {
    ownForm.classList.add('show');
    if (b.dataset.ready !== '1') { document.getElementById('ownUrl').focus(); return; }
  } else ownForm.classList.remove('show');
  document.querySelectorAll('.fmt').forEach((x) => x.setAttribute('aria-pressed', x === b));
  fmt = b.dataset.format; show();
  // The chosen format is the one that gets sent.
  try { await postJson('/api/newsletters/' + id, { format: fmt }); } catch (e) {}
}));
document.getElementById('reload').addEventListener('click', () => { location.href = location.pathname + '?refresh=1'; });
document.getElementById('sendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = document.getElementById('sendMsg'), b = document.getElementById('sendBtn');
  const email = document.getElementById('email').value.trim();
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return showMsg(m, 'err', 'Enter a valid email address.');
  b.disabled = true; b.textContent = 'Sending…';
  try { await postJson('/api/newsletters/' + id + '/send', { email }); showMsg(m, 'ok', 'Sent to ' + email + '. Check your inbox.'); }
  catch (err) { showMsg(m, 'err', err.message); }
  finally { b.disabled = false; b.textContent = 'Send'; }
});
async function update(body, m, done) {
  try { await postJson('/api/newsletters/' + id, body); showMsg(m, 'ok', done); setTimeout(() => location.reload(), 600); }
  catch (err) { showMsg(m, 'err', err.message); }
}
dropZone(document.getElementById('logoDrop'), async (f) => update({ logo: await readFile(f, true) }, document.getElementById('mastMsg'), 'Logo updated.'));
document.getElementById('nameForm').addEventListener('submit', (e) => { e.preventDefault(); update({ name: document.getElementById('pubName').value }, document.getElementById('mastMsg'), 'Name updated.'); });
const rssDrop = document.getElementById('rssDrop');
if (rssDrop) dropZone(rssDrop, async (f) => update({ rss: await readFile(f, false) }, document.getElementById('rssMsg'), 'Stories updated.'));`;
  return layout(`${pub.name} newsletter`, body, script);
}

const ampUnavailable = (rec) =>
  `<!doctype html><meta charset="utf-8"><body style="font:15px/1.5 Arial,sans-serif;color:#333;padding:32px;text-align:center">
<p><b>The live version isn't available for this design.</b></p>
<p>Your newsletter's HTML uses something Gmail's live (AMP) email doesn't allow, so it will be sent as a regular email with the latest stories at the time of sending.</p>
<p><a href="/n/${rec.id}/preview?format=custom">See the regular version</a></p></body>`;

const notFound = () => layout('Not found', '<h1>Not found</h1><p class="lede">That newsletter does not exist. <a href="/">Build a new one</a>.</p>');
const error = (msgHtml) => layout('Something went wrong', `<h1>Something went wrong</h1><p class="lede">${msgHtml}</p><p><a href="/">Back</a></p>`);

module.exports = { home, dashboard, notFound, error, ampUnavailable };
