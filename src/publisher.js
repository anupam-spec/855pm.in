'use strict';
/**
 * Publisher newsletters: what a publisher submitted (a site/feed URL or an
 * uploaded RSS file), the publication details and the latest stories.
 *
 * Each newsletter is a folder under DATA_DIR: newsletter.json, feed.xml (the
 * uploaded or generated RSS) and logo.<type>. Stories are refreshed from the
 * source when the live endpoint is asked for them and the copy is older than
 * REFRESH_SECONDS; the stale copy is served meanwhile so email opens are fast.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveSource, fetchFeed, parseFeed, buildRss, enrichArticles } = require('./feed');
const { dedupeArticles, normalizeUrl } = require('./util');
const { findLogo, wikidataLogo, normalizeLogo, displaySize } = require('./logo');
const { fetchText } = require('./fetcher');
const { importNewsletter } = require('./custom-format');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const REFRESH_MS = (Number(process.env.REFRESH_SECONDS) || 300) * 1000;
const ARTICLE_LIMIT = 15;

/** A problem with what the publisher sent, shown to them as is. */
const inputError = (message) => Object.assign(new Error(message), { status: 422 });

const dirOf = (id) => path.join(DATA_DIR, id);
const validId = (id) => /^[a-z0-9]{10,32}$/.test(id || '');

function save(rec) {
  fs.mkdirSync(dirOf(rec.id), { recursive: true });
  const file = path.join(dirOf(rec.id), 'newsletter.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(rec, null, 2));
  fs.renameSync(file + '.tmp', file);
  return rec;
}

function load(id) {
  if (!validId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dirOf(id), 'newsletter.json'), 'utf8'));
  } catch {
    return null;
  }
}

function logoFile(rec) {
  return rec.logo ? path.join(dirOf(rec.id), `logo.${rec.logo.type}`) : null;
}

async function storeLogo(rec, logo) {
  if (!logo) return;
  fs.mkdirSync(dirOf(rec.id), { recursive: true });
  if (rec.logo) fs.rmSync(logoFile(rec), { force: true });
  rec.logo = { type: logo.type, ...displaySize(logo), version: Date.now() };
  fs.writeFileSync(logoFile(rec), logo.buffer);
}

function stripTracking(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) url.searchParams.delete(k);
    return url.toString();
  } catch {
    return u;
  }
}

/** Publication + articles from an uploaded RSS document. */
function fromUploadedRss(text) {
  let feed;
  try {
    feed = parseFeed(text, 'https://example.invalid/');
  } catch {
    throw inputError("That file isn't an RSS or Atom feed. Download the sample to see the format.");
  }
  const articles = dedupeArticles(feed.items).filter((a) => a.title && /^https?:\/\//.test(a.link));
  if (!articles.length) throw inputError('The RSS file has no stories with a title and link.');
  const site = /^https?:\/\//.test(feed.link) && !feed.link.includes('example.invalid') ? feed.link : new URL('/', articles[0].link).toString();
  const name = (feed.title || '').split(/\s+[|\-–—:]\s+/)[0].trim() || new URL(site).hostname.replace(/^www\./, '');
  return { publication: { name, url: site, description: feed.description || '', logo: feed.image || '', themeColor: '' }, articles };
}

/**
 * Create a newsletter from what the publisher submitted.
 * @param {{url?:string, rss?:string, logo?:Buffer, name?:string}} input
 */
async function createNewsletter(input) {
  const rec = { id: crypto.randomBytes(8).toString('hex'), createdAt: new Date().toISOString() };
  let publication;
  let articles;
  if (input.rss) {
    ({ publication, articles } = fromUploadedRss(input.rss));
    Object.assign(rec, { kind: 'rss', source: 'upload', input: '', feedUrl: '' });
    fs.mkdirSync(dirOf(rec.id), { recursive: true });
    fs.writeFileSync(path.join(dirOf(rec.id), 'feed.xml'), input.rss);
  } else if (input.url) {
    const url = normalizeUrl(input.url);
    const result = await resolveSource(url, { limit: ARTICLE_LIMIT });
    ({ publication, articles } = result);
    Object.assign(rec, { kind: 'url', source: result.source, input: url, feedUrl: result.feedUrl || '' });
    fs.mkdirSync(dirOf(rec.id), { recursive: true });
    fs.writeFileSync(path.join(dirOf(rec.id), 'feed.xml'), result.rss);
  } else {
    throw inputError('Give a website URL, a feed URL or an RSS file.');
  }
  rec.publication = {
    name: (input.name || '').trim() || publication.name,
    url: stripTracking(publication.url),
    description: publication.description || '',
    accent: publication.themeColor || '',
  };
  rec.articles = articles.slice(0, ARTICLE_LIMIT);
  // The live email keeps this many story slots for good.
  rec.slots = Math.min(12, rec.articles.length);
  rec.format = input.format || 'magazine';
  rec.builtAt = new Date().toISOString();
  rec.refreshedAt = rec.builtAt;
  if (input.logo) await storeLogo(rec, await normalizeLogo(input.logo));
  else {
    const found = await findLogo(publication);
    if (found?.logo) await storeLogo(rec, found.logo);
    rec.logoSource = found?.from || '';
    // Sites that block us only give a name made from their domain ("Wsj") or a feed title ("NYT > Top Stories").
    if (publication.nameFromHost && !(input.name || '').trim()) {
      const name = found?.name || (await wikidataLogo(publication.url))?.name;
      if (name) rec.publication.name = name;
    }
  }
  if (input.logo && !rec.logo) rec.logoError = 'The uploaded logo could not be read; use a PNG, JPEG, GIF, WebP or SVG.';
  return save(rec);
}

async function updateNewsletter(id, { rss, logo, name, format }) {
  const rec = load(id);
  if (!rec) return null;
  if (rss) {
    const parsed = fromUploadedRss(rss);
    rec.articles = parsed.articles.slice(0, ARTICLE_LIMIT);
    rec.builtAt = rec.refreshedAt = new Date().toISOString();
    fs.writeFileSync(path.join(dirOf(id), 'feed.xml'), rss);
  }
  if (logo) {
    const l = await normalizeLogo(logo);
    if (!l) throw inputError('The logo could not be read; use a PNG, JPEG, GIF, WebP or SVG.');
    await storeLogo(rec, l);
  }
  if (name && name.trim()) rec.publication.name = name.trim();
  if (format) rec.format = format;
  delete rec.logoError;
  return save(rec);
}

/**
 * Use the publisher's existing newsletter (the web version of an issue) as
 * their design: fetch it, keep a cleaned copy and switch to that format.
 */
async function setCustomNewsletter(id, url) {
  const rec = load(id);
  if (!rec) return null;
  let page;
  try {
    page = await fetchText(normalizeUrl(url), { accept: 'text/html,application/xhtml+xml' });
  } catch (err) {
    throw inputError(`We couldn't open that link (${err.message}).`);
  }
  const imported = importNewsletter(page.text, page.url);
  fs.writeFileSync(path.join(dirOf(id), 'custom.html'), imported.html);
  rec.custom = { url: page.url, stories: imported.stories, title: imported.title, importedAt: new Date().toISOString() };
  rec.format = 'custom';
  return save(rec);
}

/** Re-fetch stories from the source. Uploaded feeds change only on re-upload. */
async function refresh(rec) {
  if (rec.kind !== 'url') return rec;
  let articles;
  if (rec.feedUrl) {
    const feed = await fetchFeed(rec.feedUrl);
    articles = await enrichArticles(feed.items.slice(0, ARTICLE_LIMIT), { limit: 8 }).catch(() => feed.items.slice(0, ARTICLE_LIMIT));
  } else {
    const result = await resolveSource(rec.input, { limit: ARTICLE_LIMIT });
    articles = result.articles;
  }
  if (!articles.length) return rec;
  // Keep images we found earlier for the same stories.
  const old = new Map(rec.articles.map((a) => [a.link, a]));
  for (const a of articles) a.image ||= old.get(a.link)?.image || '';
  // Top up with earlier stories so the email's story slots stay full.
  const seen = new Set(articles.map((a) => a.link));
  articles = articles.concat(rec.articles.filter((a) => !seen.has(a.link)));
  const fresh = load(rec.id) || rec;
  fresh.articles = articles.slice(0, ARTICLE_LIMIT);
  fresh.builtAt = fresh.refreshedAt = new Date().toISOString();
  delete fresh.lastRefreshError;
  await retryLogo(fresh);
  fs.writeFileSync(path.join(dirOf(rec.id), 'feed.xml'), buildRss({ publication: { ...fresh.publication, logo: '' }, articles: fresh.articles }));
  return save(fresh);
}

/** A newsletter built without a logo looks for one again on rebuild, at most hourly. */
async function retryLogo(rec) {
  if (rec.logo || Date.now() - Date.parse(rec.logoTriedAt || 0) < 3600e3) return;
  rec.logoTriedAt = new Date().toISOString();
  try {
    const { publication } = await resolveSource(rec.input, { limit: 1, enrich: false });
    const found = await findLogo(publication);
    if (found?.logo) {
      await storeLogo(rec, found.logo);
      rec.logoSource = found.from;
    }
  } catch {
    /* keep the name-only masthead */
  }
}

const inflight = new Map();

/**
 * The newsletter with stories no older than REFRESH_SECONDS when possible.
 * `wait: false` returns the stored copy at once and refreshes in the
 * background (used by email opens, which must answer quickly).
 */
async function latest(id, { wait = true, force = false } = {}) {
  const rec = load(id);
  if (!rec) return null;
  const stale = force || Date.now() - Date.parse(rec.refreshedAt) > REFRESH_MS;
  if (!stale || rec.kind !== 'url') return rec;
  if (!inflight.has(id)) {
    const p = refresh(rec)
      .catch((err) => {
        // Don't hammer a failing source: count this as a refresh attempt.
        const cur = load(id);
        if (cur) save({ ...cur, refreshedAt: new Date().toISOString(), lastRefreshError: err.message });
        return cur || rec;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return wait ? inflight.get(id) : rec;
}

module.exports = { createNewsletter, updateNewsletter, setCustomNewsletter, load, latest, logoFile, validId, fromUploadedRss, DATA_DIR };
