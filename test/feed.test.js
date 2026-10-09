'use strict';
process.env.DISABLE_HEADLESS = '1';
delete process.env.GROQ_API_KEY;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { parseFeed, parseSitemap, buildRss, looksLikeFeed, resolveSource, titleFromSlug } = require('../src/feed');

const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

/* ---------------- Parsing ---------------- */

test('RSS 2.0: CDATA, entities, largest media:content, tz-aware dates', () => {
  const f = parseFeed(fx('rss2.xml'), 'https://www.indiatoday.in/rss/home');
  assert.equal(f.title, 'India Today | Home');
  assert.equal(f.image, 'https://akm-img-a-in.tosshub.com/sites/rss/logo.png');
  assert.equal(f.items.length, 2);
  assert.equal(f.items[0].title, 'Sensex jumps 500 points as banks rally & IT stocks gain');
  assert.equal(f.items[0].description, 'Markets closed higher on Thursday & banks led.');
  assert.equal(f.items[0].image, 'https://akm-img-a-in.tosshub.com/a.jpg');
  assert.equal(f.items[0].author, 'Business Desk');
  assert.equal(f.items[0].pubDate, '2026-10-09T04:45:00.000Z');
  assert.equal(f.items[1].image, 'https://akm-img-a-in.tosshub.com/big.jpg');
});

test('Atom: alternate links, relative hrefs, HTML titles, several authors', () => {
  const f = parseFeed(fx('atom.xml'), 'https://www.theverge.com/rss/index.xml');
  assert.equal(f.link, 'https://www.theverge.com/');
  assert.equal(f.language, 'en-US');
  assert.equal(f.items[0].title, 'A new phone launched');
  assert.equal(f.items[0].image, 'https://cdn.vox-cdn.com/phone.jpg');
  assert.equal(f.items[0].category, 'Tech');
  assert.equal(f.items[1].link, 'https://www.theverge.com/2026/10/9/second');
  assert.equal(f.items[1].author, 'John Roe, Ann Poe');
});

test('RSS 1.0 / RDF: items outside channel, dc:date', () => {
  const f = parseFeed(fx('rdf.xml'), 'https://slashdot.org/');
  assert.equal(f.title, 'Slashdot');
  assert.deepEqual(f.items.map((i) => i.title), ['First RDF story', 'Second RDF story']);
  assert.equal(f.items[0].author, 'msmash');
  assert.equal(f.items[0].pubDate, '2026-10-09T12:00:00.000Z');
});

test('JSON Feed: content_html, authors[], untitled items', () => {
  const f = parseFeed(fx('feed.json'), 'https://www.jsonfeed.org/feed.json');
  assert.equal(f.items[0].author, 'Manton');
  assert.equal(f.items[0].description, "We've updated the spec.");
  assert.match(f.items[1].title, /^An item with no title/);
  assert.equal(f.items[1].image, 'https://www.jsonfeed.org/img.png');
});

test('Broken feed: BOM, PHP warning, bare &, control chars, unclosed item', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'broken.xml'), 'latin1');
  assert.ok(looksLikeFeed(text.replace(/^[\s\S]*?(?=<\?xml)/, '')));
  const f = parseFeed(text, 'https://broken.example/feed');
  assert.equal(f.title, 'Broken & Co');
  assert.equal(f.items[0].title, 'Tom & Jerry return');
  assert.equal(f.items[0].pubDate, '');
  assert.equal(f.items.length, 2);
});

test('Non-feeds are rejected', () => {
  assert.throws(() => parseFeed('<html><body>hi</body></html>', 'https://x.example/'));
  assert.equal(looksLikeFeed('{"a":1}', 'application/json'), false);
});

test('News sitemap: titles, images, newest first', () => {
  const m = parseSitemap(fx('news-sitemap.xml'), 'https://www.livemint.com/');
  assert.equal(m.type, 'urlset');
  assert.equal(m.items[0].title, 'How to save tax this year');
  assert.equal(m.items.find((i) => /sensex-nifty/.test(i.link)).image, 'https://www.livemint.com/lm-img/sensex.jpg');
});

test('titleFromSlug drops ids and dates', () => {
  assert.equal(titleFromSlug('https://www.livemint.com/companies/news/tata-motors-q2-sales-rise-11760000000003.html'), 'Tata motors sales rise');
  assert.equal(titleFromSlug('https://x.example/2026/10/09/'), '');
});

test('buildRss output round-trips through parseFeed', () => {
  const rss = buildRss({
    publication: { name: 'A & B <News>', url: 'https://ab.example/', logo: 'https://ab.example/logo.png' },
    articles: [
      { title: 'One "quoted" & tagged', link: 'https://ab.example/one?utm_source=x', description: 'd1', image: 'https://ab.example/1.jpg', pubDate: '2026-10-09T04:45:00.000Z', author: 'Me', category: 'News' },
      { title: 'One duplicate', link: 'https://ab.example/one', description: '' },
      { title: '', link: 'https://ab.example/no-title' },
    ],
    selfUrl: 'https://855pm.in/feeds/ab.xml',
  });
  const f = parseFeed(rss, 'https://855pm.in/feeds/ab.xml');
  assert.equal(f.title, 'A & B <News>');
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].title, 'One "quoted" & tagged');
  assert.equal(f.items[0].image, 'https://ab.example/1.jpg');
  assert.equal(f.items[0].pubDate, '2026-10-09T04:45:00.000Z');
});

/* ---------------- resolveSource against a local server ---------------- */

// One throwaway server per scenario, since discovery probes the site root (/robots.txt, /feed ...).
const servers = [];
async function site(routes) {
  const server = http.createServer((req, res) => {
    const r = routes[req.url];
    if (!r) {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('<html><body>Not found</body></html>');
    }
    res.writeHead(r.status || 200, { 'content-type': r.type });
    res.end(r.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
after(() => servers.forEach((s) => s.close()));

const HTML = 'text/html; charset=utf-8';
const XML = 'application/rss+xml';

test('feed URL pasted directly', async () => {
  const url = await site({ '/rss/home': { type: XML, body: fx('rss2.xml') } });
  const r = await resolveSource(`${url}/rss/home`);
  assert.equal(r.source, 'feed');
  assert.equal(r.publication.name, 'India Today');
  assert.equal(r.articles.length, 2);
  assert.match(r.rss, /<rss version="2.0"/);
});

test('homepage advertising a feed via <link rel=alternate>', async () => {
  const url = await site({ '/': { type: HTML, body: fx('home-with-feed.html') }, '/rss/home': { type: XML, body: fx('rss2.xml') } });
  const r = await resolveSource(url);
  assert.equal(r.source, 'feed');
  assert.equal(r.feedUrl, `${url}/rss/home`);
  assert.equal(r.articles[0].title, 'Sensex jumps 500 points as banks rally & IT stocks gain');
});

test('homepage with no advertised feed but a /feed path', async () => {
  const url = await site({
    '/': { type: HTML, body: '<html><head><title>Blog</title></head><body>hi</body></html>' },
    '/feed': { type: 'application/atom+xml', body: fx('atom.xml') },
  });
  const r = await resolveSource(url);
  assert.equal(r.source, 'feed');
  assert.equal(r.articles.length, 2);
});

test('site without any feed: scrapes articles, enriches them, generates RSS', async () => {
  const article = { type: HTML, body: fx('article.html') };
  const url = await site({
    '/': { type: HTML, body: fx('home-no-feed.html') },
    '/politics/2026/10/09/parliament-passes-new-data-protection-bill-1012345.html': article,
    '/business/2026/10/09/rupee-hits-record-high-against-dollar-1012346.html': article,
  });
  const r = await resolveSource(url);
  assert.equal(r.source, 'scrape');
  assert.equal(r.publication.name, 'Daily Example');
  assert.equal(r.publication.themeColor, '#c8102e');
  assert.equal(r.publication.logo, `${url}/static/logo.png`);
  const titles = r.articles.map((a) => a.title);
  assert.equal(titles[0], 'Parliament passes new data protection bill after long debate');
  assert.equal(titles.length, 6);
  assert.ok(!titles.some((t) => /privacy|Twitter|Politics coverage|newsroom/i.test(t)), titles.join(' / '));
  assert.equal(r.articles[0].image, `${url}/img/parliament.jpg`);
  assert.match(r.articles[0].description, /three days/);
  // Enriched from the article page's Open Graph tags.
  assert.equal(r.articles[1].image, `${url}/img/og.jpg`);
  assert.equal(r.articles[1].author, 'Staff Reporter');
  const regenerated = parseFeed(r.rss, url);
  assert.equal(regenerated.items.length, 6);
});

test('Cloudflare-blocked homepage falls back to the news sitemap from robots.txt', async () => {
  const url = await site({
    '/': { type: HTML, body: fx('cloudflare.html'), status: 403 },
    '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /search\nSitemap: /sitemap.xml\nSitemap: /sitemaps/today.xml\n' },
    '/sitemaps/today.xml': { type: 'application/xml', body: fx('news-sitemap.xml') },
  });
  const r = await resolveSource(url, { enrich: false });
  assert.equal(r.source, 'sitemap');
  assert.equal(r.articles.length, 5);
  assert.equal(r.articles[0].title, 'How to save tax this year');
  assert.ok(r.articles.some((a) => a.title === 'Tata motors sales rise'));
  assert.ok(r.attempts.some((a) => a.step === 'page' && a.blocked));
});

test('fully blocked site gives a clear BLOCKED error with attempts', async () => {
  const url = await site({ '/': { type: HTML, body: fx('cloudflare.html'), status: 403 } });
  await assert.rejects(resolveSource(url), (err) => {
    assert.equal(err.code, 'BLOCKED');
    assert.match(err.message, /blocks automated access/);
    assert.ok(err.attempts.length > 5);
    return true;
  });
});

test('bad input is rejected before any request', async () => {
  await assert.rejects(resolveSource('not a url'), /not a valid URL/);
});
