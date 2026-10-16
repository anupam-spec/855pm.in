'use strict';
process.env.DISABLE_HEADLESS = '1';
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), '855pm-test-'));
for (const k of ['SMTP_URL', 'SMTP_HOST', 'MAIL_FROM', 'PUBLIC_BASE_URL']) delete process.env[k];

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const formats = require('../src/email-formats');
const { imageSize } = require('../src/logo');
const { fromUploadedRss } = require('../src/publisher');
const { createServer, ampCorsHeaders } = require('../src/server');

const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('imageSize reads PNG dimensions', () => {
  assert.deepEqual(imageSize(PNG), { type: 'png', width: 1, height: 1 });
  assert.equal(imageSize(Buffer.from('not an image at all, just text')), null);
});

test('uploaded RSS gives publication and stories', () => {
  const { publication, articles } = fromUploadedRss(fx('rss2.xml'));
  assert.equal(publication.name, 'India Today');
  assert.ok(articles.length >= 2);
  assert.throws(() => fromUploadedRss('<html>nope</html>'), /isn't an RSS/);
});

const sampleRec = () => ({
  id: 'abcdef0123456789',
  publication: { name: 'India Today', url: 'https://www.indiatoday.in/', accent: '' },
  logo: { type: 'png', width: 200, height: 40, version: 1 },
  articles: fromUploadedRss(fx('rss2.xml')).articles,
  slots: 2,
  format: 'magazine',
  builtAt: '2026-10-12T09:20:00Z',
});
const BASE = 'https://x.example';

test('every format: logo masthead, build time, ad slots, live AMP list', () => {
  const rec = sampleRec();
  for (const f of formats.FORMATS) {
    const html = formats.renderHtmlEmail(rec, BASE, f.id);
    assert.match(html, /x\.example\/n\/abcdef0123456789\/logo\?v=1/, f.id);
    assert.match(html, /12 Oct,? 2026, 02:50 pm IST/i, f.id);
    assert.match(html, /gampad\/jump\?iu=%2F6499%2F/, f.id);
    assert.match(html, /Sensex jumps 500 points/, f.id);
    const amp = formats.renderAmpEmail(rec, BASE, f.id);
    assert.match(amp, /<html ⚡4email/);
    assert.match(amp, new RegExp(`<amp-list src="https://x.example/n/abcdef0123456789/live.json\\?format=${f.id}"`));
    assert.match(amp, /\{\{s\.0\.title\}\}/);
    assert.match(amp, /\{\{updated\}\}/);
    assert.ok(!/<img\s/.test(amp), `${f.id}: AMP part must use amp-img`);
    assert.ok(Buffer.byteLength(amp) < 200 * 1024, `${f.id}: Gmail limit is 200 KB`);
  }
});

test('live data fills every story slot', () => {
  const rec = { ...sampleRec(), slots: 5 };
  const live = formats.liveData(rec, BASE);
  assert.equal(live.s.length, 5);
  assert.match(live.updated, /IST$/);
  assert.ok(live.s.every((s) => s.title && s.link && /^https:/.test(s.image) && s.category));
});

test('AMP emails pass the AMP4EMAIL validator', async (t) => {
  let validator;
  try {
    validator = await require('amphtml-validator').getInstance();
  } catch {
    return t.skip('validator could not be downloaded');
  }
  for (const f of formats.FORMATS) {
    const result = validator.validateString(formats.renderAmpEmail(sampleRec(), BASE, f.id), 'AMP4EMAIL');
    assert.equal(result.status, 'PASS', `${f.id}: ${JSON.stringify(result.errors.slice(0, 3))}`);
  }
});

test('live endpoint CORS headers for AMP email', () => {
  const url = new URL('https://x/n/a/live.json?__amp_source_origin=foo%40gmail.com');
  const h = ampCorsHeaders({ headers: { 'amp-email-sender': 'foo@gmail.com', origin: 'https://mail.google.com' } }, url);
  assert.equal(h['AMP-Email-Allow-Sender'], '*');
  assert.equal(h['Access-Control-Allow-Origin'], 'https://mail.google.com');
  assert.equal(h['AMP-Access-Control-Allow-Source-Origin'], 'foo@gmail.com');
});

let server;
let base;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('site: upload RSS + logo, preview, live JSON, .eml, send needs a provider', async () => {
  assert.match(await (await fetch(base + '/')).text(), /Upload RSS file/);
  const res = await post('/api/newsletters', { rss: fx('rss2.xml'), logo: `data:image/png;base64,${PNG.toString('base64')}` });
  assert.equal(res.status, 201);
  const { id, next } = await res.json();
  assert.equal(next, `/n/${id}`);

  assert.match(await (await fetch(base + next)).text(), /Send it to your Gmail/);
  const preview = await (await fetch(`${base}/n/${id}/preview?format=digest`)).text();
  assert.match(preview, new RegExp(`/n/${id}/logo\\?v=`));
  assert.equal((await post(`/api/newsletters/${id}`, { format: 'tiles' })).status, 200);
  assert.match(await (await fetch(base + next)).text(), /data-format="tiles"[^>]*>|aria-pressed="true" data-format="tiles"/);
  assert.equal((await fetch(`${base}/n/${id}/logo`)).headers.get('content-type'), 'image/png');

  const live = await (await fetch(`${base}/n/${id}/live.json`)).json();
  assert.match(live.updated, /IST$/);
  assert.equal(live.format, 'tiles');
  assert.ok(live.s.length >= 1);

  const eml = await (await fetch(`${base}/n/${id}/email.eml`)).text();
  const order = ['text/plain', 'text/x-amp-html', 'text/html'].map((t) => eml.indexOf(`Content-Type: ${t}`));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'parts in Gmail order');

  const sent = await post(`/api/newsletters/${id}/send`, { email: 'someone@gmail.com' });
  assert.equal(sent.status, 503);
  assert.match((await sent.json()).error, /not set up/);
  assert.equal((await post(`/api/newsletters/${id}/send`, { email: 'bad' })).status, 400);

  const bad = await post('/api/newsletters', { rss: '<html></html>' });
  assert.equal(bad.status, 422);
});

test('light theme colours are not used for buttons; Read more buttons stay readable', () => {
  const { usableAccent, textOn } = require('../src/templates/shared');
  assert.equal(usableAccent('#e3eef9'), '');
  assert.equal(usableAccent('#ffffff'), '');
  assert.equal(usableAccent('#C04A4A'), '#C04A4A');
  assert.equal(textOn('#f99d1c'), '#111111');
  assert.equal(textOn('#e31e24'), '#ffffff');
  const rec = { ...sampleRec(), publication: { ...sampleRec().publication, accent: '#e3eef9' } };
  for (const f of formats.FORMATS) {
    const html = formats.renderHtmlEmail(rec, BASE, f.id);
    assert.ok(!/#e3eef9/i.test(html), f.id);
    if (f.id !== 'tiles') assert.match(html, /Read (more|the story) →/, f.id);
  }
});

test('"Your newsletter": stories in an existing newsletter are swapped for live ones', async () => {
  const custom = require('../src/custom-format');
  const imported = custom.importNewsletter(fx('existing-newsletter.html'), 'https://news.example.com/webversion/123');
  assert.equal(imported.stories, 3);
  assert.ok(!/trackOpen|onclick/.test(imported.html), 'scripts and handlers removed');
  assert.match(imported.html, /src="https:\/\/news.example.com\/img\/logo.png"/, 'relative images made absolute');

  const stories = [1, 2, 3].map((n) => ({ title: `New headline ${n}`, link: `https://news.example.com/new-${n}`, summary: `New summary ${n}`, image: `https://cdn.example.com/new-${n}.jpg` }));
  const html = custom.render(imported, { stories, updated: '12 Oct 2026, 2:50 pm IST' });
  for (const n of [1, 2, 3]) assert.match(html, new RegExp(`New headline ${n}`));
  assert.ok(!/Old story/.test(html), 'old headlines replaced');
  assert.ok(!/old-story/.test(html), 'old links replaced');
  assert.match(html, /new-1\.jpg/);
  assert.match(html, /New summary 1/);
  assert.match(html, /New summary 2/);
  assert.match(html, /Updated 12 Oct 2026/);
  assert.match(html, /facebook\.com\/examplenews/, 'social links kept');
  assert.match(html, /list-manage\.com\/unsubscribe/, 'unsubscribe kept');
  assert.match(html, /news\.example\.com\/"/, 'logo link kept');

  assert.throws(() => custom.importNewsletter('<html><body><p>No links here</p></body></html>', 'https://x.example/'), /couldn't find any stories/);
});

test('logo candidates: JSON-LD, lazy/srcset header images, inline SVG, icons', async () => {
  const cheerio = require('cheerio');
  const { extractPublication } = require('../src/extract');
  const { downloadLogo } = require('../src/logo');
  const page = (body, head = '') => cheerio.load(`<html><head>${head}</head><body>${body}</body></html>`);
  const url = 'https://news.example.com/';

  const ld = extractPublication(page('', '<script type="application/ld+json">{"@type":"NewsMediaOrganization","name":"Example","logo":{"@type":"ImageObject","url":"/img/ld-logo.png"}}</script>'), url);
  assert.equal(ld.logoCandidates[0], 'https://news.example.com/img/ld-logo.png');

  const lazy = extractPublication(page('<header><a href="/"><img class="site-logo" src="data:image/gif;base64,R0lGOD" data-src="/img/lazy-logo.png" alt="Example"></a></header>'), url);
  assert.ok(lazy.logoCandidates.includes('https://news.example.com/img/lazy-logo.png'), JSON.stringify(lazy.logoCandidates));

  const srcset = extractPublication(page('<header><img class="logo" srcset="/img/l-1x.png 1x, /img/l-2x.png 2x"></header>'), url);
  assert.ok(srcset.logoCandidates.includes('https://news.example.com/img/l-2x.png'), JSON.stringify(srcset.logoCandidates));

  const svg = extractPublication(page('<header><a href="/" aria-label="Example home"><svg viewBox="0 0 100 20" class="logo"><path d="M0 0h100v20H0z"/></svg></a></header>'), url);
  const inline = svg.logoCandidates.find((c) => c.startsWith('data:image/svg+xml;base64,'));
  assert.ok(inline, 'inline SVG becomes a data URL');
  assert.match(Buffer.from(inline.split(',')[1], 'base64').toString(), /<svg[^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);

  const icons = extractPublication(page('', '<link rel="apple-touch-icon" href="/apple-180.png">'), url);
  assert.ok(icons.iconCandidates.includes('https://news.example.com/apple-180.png'));

  const png = await downloadLogo(`data:image/png;base64,${PNG.toString('base64')}`);
  assert.deepEqual([png.type, png.width, png.height], ['png', 1, 1]);
});

test('wide logos keep their shape in the masthead', () => {
  const rec = { ...sampleRec(), logo: { type: 'png', width: 960, height: 90, version: 1 } };
  for (const f of formats.FORMATS) {
    const html = formats.renderHtmlEmail(rec, BASE, f.id);
    const img = html.match(/<img src="[^"]*\/logo\?v=1"[^>]*>/)[0];
    assert.match(img, /height="23" width="240"/, `${f.id}: ${img}`);
    assert.match(img, /height:23px;width:240px/, f.id);
  }
});
