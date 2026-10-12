'use strict';
process.env.DISABLE_HEADLESS = '1';
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), '855pm-test-'));
for (const k of ['SMTP_URL', 'SMTP_HOST', 'MAIL_FROM', 'PUBLIC_BASE_URL']) delete process.env[k];

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { renderAmp, renderHtml, liveJson, formatStamp } = require('../src/amp-email');
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

test('formatStamp prints IST', () => {
  assert.equal(formatStamp('2026-10-12T09:20:00Z'), '12 Oct 2026, 2:50 PM IST');
});

test('uploaded RSS gives publication and stories', () => {
  const { publication, articles } = fromUploadedRss(fx('rss2.xml'));
  assert.equal(publication.name, 'India Today');
  assert.ok(articles.length >= 2);
  assert.throws(() => fromUploadedRss('<html>nope</html>'), /isn't an RSS/);
});

const sample = () => {
  const articles = fromUploadedRss(fx('rss2.xml')).articles;
  const pub = { name: 'India Today', url: 'https://www.indiatoday.in/', logoUrl: 'https://x.example/n/a/logo', logoWidth: 200, logoHeight: 40 };
  return { pub, data: liveJson({ articles, builtAt: '2026-10-12T09:20:00Z' }) };
};

test('AMP email: live list, logo masthead, build time, fallback content', () => {
  const { pub, data } = sample();
  const amp = renderAmp({ publication: pub, liveUrl: 'https://x.example/n/a/live.json', fallback: data });
  assert.match(amp, /<html ⚡4email data-css-strict>/);
  assert.match(amp, /<amp-list src="https:\/\/x.example\/n\/a\/live.json"/);
  assert.match(amp, /amp-img class="logo" src="https:\/\/x.example\/n\/a\/logo"/);
  assert.match(amp, /Updated \{\{updated\}\}/);
  assert.match(amp, /Updated 12 Oct 2026, 2:50 PM IST/);
  assert.ok(!/<img\s/.test(amp), 'AMP part must use amp-img');
  assert.ok(Buffer.byteLength(amp) < 200 * 1024, 'Gmail limit is 200 KB');
  const html = renderHtml({ publication: pub, data });
  assert.match(html, /Updated 12 Oct 2026, 2:50 PM IST/);
  assert.match(html, /Sensex jumps 500 points/);
});

test('AMP email passes the AMP4EMAIL validator', async (t) => {
  let validator;
  try {
    validator = await require('amphtml-validator').getInstance();
  } catch {
    return t.skip('validator could not be downloaded');
  }
  const { pub, data } = sample();
  const result = validator.validateString(renderAmp({ publication: pub, liveUrl: 'https://x.example/n/a/live.json', fallback: data }), 'AMP4EMAIL');
  assert.equal(result.status, 'PASS', JSON.stringify(result.errors));
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
  const preview = await (await fetch(`${base}/n/${id}/preview`)).text();
  assert.match(preview, new RegExp(`/n/${id}/logo\\?v=`));
  assert.equal((await fetch(`${base}/n/${id}/logo`)).headers.get('content-type'), 'image/png');

  const live = await (await fetch(`${base}/n/${id}/live.json`)).json();
  assert.match(live.updated, /IST$/);
  assert.equal(live.lead.length, 1);

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
