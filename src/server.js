'use strict';
/**
 * Publisher site: a publisher gives us their website/feed URL or uploads an
 * RSS file, watches their newsletter get built, and sends it to their inbox.
 *
 *   GET  /                          upload page
 *   GET  /format                    sample RSS in our format
 *   POST /api/newsletters           {url} | {rss}, optional {logo, name} -> {id}
 *   POST /api/newsletters/:id       replace {logo} / {rss} / {name}
 *   POST /api/newsletters/:id/send  {email}
 *   GET  /n/:id                     publisher dashboard (preview + send)
 *   GET  /n/:id/preview             HTML email, rebuilt with the latest stories
 *   GET  /n/:id/amp                 AMP email
 *   GET  /n/:id/live.json           live stories for the AMP email (CORS for email)
 *   GET  /n/:id/email.eml           the full email as a file
 *   GET  /n/:id/logo, /n/:id/feed.xml
 *
 * PUBLIC_BASE_URL sets the https address emails point at; otherwise it is
 * taken from the request (X-Forwarded-Proto/Host behind a proxy).
 */
const http = require('http');
const fs = require('fs');
const store = require('./publisher');
const mailer = require('./mailer');
const formats = require('./email-formats');
const { buildRss } = require('./feed');
const { escapeHtml: esc } = require('./util');
const pages = require('./web/pages');

const MAX_BODY = 12 * 1024 * 1024;
const SEND_LIMIT_PER_HOUR = 20;
const sends = new Map();

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket.encrypted ? 'https' : 'http');
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0];
  return `${proto}://${host}`;
}

function send(res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
const json = (res, status, obj, headers) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', headers);

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Upload is too large (12 MB max).'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** {logo: "data:image/png;base64,..."} -> Buffer */
function fileFromDataUrl(v) {
  if (typeof v !== 'string' || !v) return null;
  const m = v.match(/^data:[^;,]*(;base64)?,(.*)$/s);
  if (!m) return null;
  return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]));
}

/**
 * AMP for Email CORS: answer the AMP-Email-Sender header (v2) and the
 * __amp_source_origin query (v1) so Gmail/Yahoo/Mail.ru render the list.
 */
function ampCorsHeaders(req, url) {
  const h = {};
  const sender = req.headers['amp-email-sender'];
  if (sender) h['AMP-Email-Allow-Sender'] = process.env.AMP_ALLOWED_SENDER || '*';
  const origin = req.headers.origin;
  if (origin) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Credentials'] = 'true';
  }
  const sourceOrigin = url.searchParams.get('__amp_source_origin');
  if (sourceOrigin) {
    h['AMP-Access-Control-Allow-Source-Origin'] = sourceOrigin;
    h['Access-Control-Expose-Headers'] = 'AMP-Access-Control-Allow-Source-Origin';
  }
  return h;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const base = baseUrl(req);

  if (req.method === 'GET' && p === '/') return send(res, 200, pages.home({ sending: mailer.sendingStatus() }));
  if (req.method === 'GET' && p === '/format') return send(res, 200, sampleRss(), 'application/rss+xml; charset=utf-8');
  if (req.method === 'GET' && p === '/healthz') return json(res, 200, { ok: true });

  if (req.method === 'POST' && p === '/api/newsletters') {
    const body = await readJson(req);
    const rec = await store.createNewsletter({ url: body.url, rss: body.rss, name: body.name, logo: fileFromDataUrl(body.logo), format: body.format && formats.formatId(body.format) });
    return json(res, 201, { id: rec.id, next: `/n/${rec.id}`, logoError: rec.logoError || '' });
  }

  let m = p.match(/^\/api\/newsletters\/([a-z0-9]+)(\/send)?$/);
  if (req.method === 'POST' && m) {
    const body = await readJson(req);
    if (m[2]) {
      const email = String(body.email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Enter a valid email address.' });
      const rec = await store.latest(m[1], { wait: true });
      if (!rec) return json(res, 404, { error: 'Newsletter not found' });
      const now = Date.now();
      const recent = (sends.get(rec.id) || []).filter((t) => now - t < 3600e3);
      if (recent.length >= SEND_LIMIT_PER_HOUR) return json(res, 429, { error: 'Too many test sends for this newsletter; try again in an hour.' });
      try {
        const info = await mailer.sendNewsletter(rec, { to: email, baseUrl: base });
        sends.set(rec.id, [...recent, now]);
        return json(res, 200, { ok: true, ...info });
      } catch (err) {
        return json(res, err.code === 'NOT_CONFIGURED' ? 503 : 502, { error: err.message, code: err.code || 'SEND_FAILED' });
      }
    }
    const rec = await store.updateNewsletter(m[1], { rss: body.rss, name: body.name, logo: fileFromDataUrl(body.logo), format: body.format && formats.formatId(body.format) });
    if (!rec) return json(res, 404, { error: 'Newsletter not found' });
    return json(res, 200, { ok: true });
  }

  m = p.match(/^\/n\/([a-z0-9]+)(?:\/(preview|amp|live\.json|email\.eml|logo|feed\.xml|noimage\.png))?$/);
  if (req.method === 'GET' && m) {
    const [, id, view] = m;
    if (!store.validId(id)) return send(res, 404, pages.notFound());
    if (view === 'noimage.png') return send(res, 200, formats.noImage(), 'image/png', { 'Cache-Control': 'public, max-age=86400' });
    // Email opens get the stored copy at once and refresh in the background.
    const rec = await store.latest(id, { wait: view !== 'live.json' && view !== 'logo', force: !view && url.searchParams.has('refresh') });
    if (!rec) return send(res, 404, pages.notFound());
    const format = formats.formatId(url.searchParams.get('format') || rec.format);
    switch (view) {
      case undefined:
        return send(res, 200, pages.dashboard({ rec, sending: mailer.sendingStatus(), formats: formats.FORMATS, format: formats.formatId(rec.format) }));
      case 'preview':
        return send(res, 200, formats.renderHtmlEmail(rec, base, format));
      case 'amp':
        return send(res, 200, formats.renderAmpEmail(rec, base, format));
      case 'live.json':
        return json(res, 200, formats.liveData(rec, base, format), ampCorsHeaders(req, url));
      case 'email.eml':
        return send(res, 200, await mailer.buildEml(rec, { to: url.searchParams.get('to') || '', baseUrl: base }), 'message/rfc822', {
          'Content-Disposition': `attachment; filename="${rec.id}.eml"`,
        });
      case 'feed.xml':
        return send(res, 200, fs.readFileSync(`${store.DATA_DIR}/${id}/feed.xml`), 'application/rss+xml; charset=utf-8');
      case 'logo': {
        const file = store.logoFile(rec);
        if (!file || !fs.existsSync(file)) return send(res, 404, 'No logo', 'text/plain');
        return send(res, 200, fs.readFileSync(file), `image/${rec.logo.type}`, { 'Cache-Control': 'public, max-age=86400' });
      }
    }
  }

  return send(res, 404, pages.notFound());
}

function sampleRss() {
  const now = Date.now();
  return buildRss({
    publication: { name: 'Example Times', url: 'https://www.example.com/', description: 'Latest stories from Example Times', language: 'en', logo: 'https://www.example.com/logo.png' },
    articles: [1, 2, 3].map((n) => ({
      title: `Headline of story ${n}`,
      link: `https://www.example.com/news/story-${n}`,
      description: `One or two sentences that summarise story ${n}.`,
      pubDate: new Date(now - n * 3600e3).toISOString(),
      author: 'Staff Reporter',
      category: n === 1 ? 'India' : 'Business',
      image: `https://www.example.com/images/story-${n}.jpg`,
    })),
  });
}

function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err.status || 500;
      if (status >= 500 && !err.attempts) console.error(err);
      if (res.headersSent) return res.end();
      if (req.url.startsWith('/api/')) return json(res, status === 500 ? 422 : status, { error: friendlyError(err) });
      send(res, status, pages.error(esc(friendlyError(err))));
    });
  });
}

function friendlyError(err) {
  if (err.attempts) return `We couldn't find stories at that address. ${err.message}`;
  return err.message || 'Something went wrong';
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  createServer().listen(port, () => console.log(`Publisher site on http://localhost:${port}`));
}

module.exports = { createServer, ampCorsHeaders };
