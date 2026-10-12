'use strict';
/**
 * Turns parsed feed / scraped site output into the newsletter JSON that every
 * template renders. Accepts either:
 *   - feed.js parseFeed() output: {title, link, description, image, language, items[]}
 *   - pipeline output:            {publication:{name,url,logo,...}, articles[]}
 */

const MAX_ARTICLES = 20;

const clean = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

function truncate(s, n) {
  s = clean(s);
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const at = cut.lastIndexOf(' ');
  return (at > n * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—]+$/, '') + '…';
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function nameFromHost(host) {
  const core = host.split('.').filter((p) => !['www', 'm', 'amp', 'co', 'com', 'in', 'org', 'net', 'my'].includes(p))[0] || host;
  return core.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function safeUrl(u) {
  try {
    const p = new URL(String(u || '').trim());
    return /^https?:$/.test(p.protocol) ? p.toString() : '';
  } catch {
    return '';
  }
}

function normalizePublication(input) {
  const p = input.publication || {};
  const url = safeUrl(p.url || input.link || input.url);
  const host = hostnameOf(url);
  return {
    name: clean(p.name || input.title) || nameFromHost(host) || 'Newsletter',
    url,
    logo: safeUrl(p.logo || input.image),
    description: clean(p.description || input.description),
    language: clean(p.language || input.language) || 'en',
    accentColor: [p.accentColor, p.themeColor].find((c) => /^#[0-9a-f]{3,8}$/i.test(c || '')) || '',
  };
}

function normalizeArticle(a) {
  const link = safeUrl(a.link || a.url);
  const title = clean(a.title);
  if (!link || !title) return null;
  const description = clean(a.description);
  return {
    title,
    link,
    summary: truncate(a.summary || description, 220),
    description,
    image: safeUrl(a.image),
    author: clean(a.author),
    category: clean(a.category),
    pubDate: a.pubDate && !Number.isNaN(new Date(a.pubDate).getTime()) ? new Date(a.pubDate).toISOString() : '',
  };
}

/**
 * Build the newsletter JSON. `polish` is the optional result of
 * groq.polishNewsletter() ({subject, preheader, intro, summaries[], categories[]}).
 */
function buildNewsletter(input, { polish = null, maxArticles = MAX_ARTICLES, now = new Date() } = {}) {
  if (!input || typeof input !== 'object') throw new Error('buildNewsletter: input must be an object');
  const publication = normalizePublication(input);
  const seen = new Set();
  const articles = [];
  for (const raw of input.articles || input.items || []) {
    const a = raw && normalizeArticle(raw);
    if (!a) continue;
    const key = a.link.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    articles.push(a);
    if (articles.length >= maxArticles) break;
  }
  if (!articles.length) throw new Error('No usable articles (each needs a title and an http(s) link)');

  if (polish) {
    for (const s of polish.summaries || []) if (articles[s.i] && s.summary) articles[s.i].summary = truncate(s.summary, 220);
    for (const c of polish.categories || []) if (articles[c.i] && !articles[c.i].category && c.category) articles[c.i].category = clean(c.category);
  }

  const lead = articles[0];
  return {
    version: 1,
    generatedAt: now.toISOString(),
    publication,
    subject: truncate(polish?.subject || `${publication.name}: ${lead.title}`, 90),
    preheader: truncate(polish?.preheader || articles.slice(1, 3).map((a) => a.title).join(' · ') || lead.summary, 120),
    intro: clean(polish?.intro),
    articles,
  };
}

/** Same as buildNewsletter, but asks Groq for subject/summaries when GROQ_API_KEY is set. */
async function buildNewsletterWithGroq(input, opts = {}) {
  const draft = buildNewsletter(input, opts);
  let polish = null;
  try {
    polish = await require('./groq').polishNewsletter(draft.publication, draft.articles);
  } catch {
    polish = null; // groq.js missing, no key, or API failure: the plain draft is still a complete newsletter
  }
  return polish ? buildNewsletter(input, { ...opts, polish }) : draft;
}

module.exports = { buildNewsletter, buildNewsletterWithGroq, truncate };
