'use strict';
/**
 * Feed parsing (RSS 0.9x/2.0, RSS 1.0/RDF, Atom, JSON Feed, Google News
 * sitemaps) and RSS 2.0 generation.
 */
const { XMLParser } = require('fast-xml-parser');
const cheerio = require('cheerio');
const { cleanText, absolutize, firstImageInHtml, stripHtml, normalizeDate, dedupeArticles, normalizeUrl, mapLimit, truncate, hostnameOf, prettyNameFromHost } = require('./util');
const { fetchText, fetchRendered, FEED_ACCEPT } = require('./fetcher');
const extract = require('./extract');
const groq = require('./groq');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  removeNSPrefix: false,
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => ['item', 'entry', 'link', 'category', 'media:content', 'media:thumbnail', 'enclosure', 'url', 'sitemap', 'image:image'].includes(name),
});

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v) => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return txt(v[0]);
  if (typeof v === 'object') return v['#text'] != null ? String(v['#text']) : '';
  return '';
};

/** Repair the most common feed breakages before parsing. */
function sanitizeXml(xml) {
  return xml
    .replace(/^\uFEFF/, '')
    .replace(/^[\s\S]*?(?=<\?xml|<rss|<feed|<rdf:RDF|<urlset|<sitemapindex)/i, '') // junk before root (PHP warnings etc.)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // illegal control chars
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, '&amp;'); // bare ampersands
}

function looksLikeFeed(text, contentType = '') {
  const head = (text || '').slice(0, 3000).trim();
  if (/json/i.test(contentType) || head.startsWith('{')) {
    return /"version"\s*:\s*"https:\/\/jsonfeed\.org/i.test(head);
  }
  return /<(rss|feed|rdf:RDF)[\s>]/i.test(head);
}

function looksLikeSitemap(text) {
  return /<(urlset|sitemapindex)[\s>]/i.test((text || '').slice(0, 3000));
}

function mediaImage(item) {
  const candidates = [];
  for (const key of ['media:content', 'media:thumbnail']) {
    for (const m of arr(item[key])) {
      if (m && m['@url'] && (!m['@medium'] || m['@medium'] === 'image') && !/\.(mp4|mp3|m3u8)(\?|$)/i.test(m['@url'])) {
        candidates.push({ url: m['@url'], w: Number(m['@width']) || 0 });
      }
    }
  }
  const group = item['media:group'];
  if (group) candidates.push(...arr(group['media:content']).filter((m) => m && m['@url']).map((m) => ({ url: m['@url'], w: Number(m['@width']) || 0 })));
  for (const e of arr(item.enclosure)) {
    if (e && e['@url'] && (/^image\//i.test(e['@type'] || '') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(e['@url']))) {
      candidates.push({ url: e['@url'], w: 0 });
    }
  }
  if (item.image) candidates.push({ url: txt(item.image.url || item.image), w: 0 });
  if (item['itunes:image']?.['@href']) candidates.push({ url: item['itunes:image']['@href'], w: 0 });
  candidates.sort((a, b) => b.w - a.w);
  return candidates.find((c) => c.url)?.url || '';
}

function atomLink(entry) {
  const links = arr(entry.link);
  const alt = links.find((l) => typeof l === 'object' && (!l['@rel'] || l['@rel'] === 'alternate') && l['@href']);
  if (alt) return alt['@href'];
  const any = links.find((l) => (typeof l === 'object' ? l['@href'] : l));
  return typeof any === 'object' ? any['@href'] : txt(any);
}

function parseJsonFeed(text, baseUrl) {
  const data = JSON.parse(text);
  return {
    title: cleanText(data.title),
    link: data.home_page_url || baseUrl,
    description: cleanText(data.description),
    image: data.icon || data.favicon || '',
    language: data.language || '',
    items: (data.items || []).map((it) => ({
      title: cleanText(it.title || stripHtml(it.content_html || it.content_text || '').slice(0, 120)),
      link: absolutize(it.url || it.external_url || it.id, baseUrl),
      description: cleanText(it.summary || stripHtml(it.content_html || it.content_text || '')),
      image: absolutize(it.image || it.banner_image || firstImageInHtml(it.content_html), baseUrl),
      author: cleanText(it.author?.name || it.authors?.[0]?.name || ''),
      category: cleanText((it.tags || [])[0] || ''),
      pubDate: normalizeDate(it.date_published || it.date_modified),
    })),
  };
}

/**
 * Parse a feed document into {title, link, description, image, language, items[]}.
 * Throws if the document is not a recognisable feed.
 */
function parseFeed(text, baseUrl) {
  const trimmed = (text || '').trim();
  if (trimmed.startsWith('{')) return parseJsonFeed(trimmed, baseUrl);

  let doc;
  try {
    doc = parser.parse(sanitizeXml(trimmed));
  } catch (err) {
    return parseFeedLoose(trimmed, baseUrl, err);
  }

  if (doc.rss || doc['rdf:RDF'] || doc.RDF) {
    const root = doc.rss || doc['rdf:RDF'] || doc.RDF;
    const channel = arr(root.channel)[0] || {};
    const items = arr(root.item || channel.item);
    const channelLink = arr(channel.link).map((l) => txt(l)).find(Boolean) || baseUrl;
    return {
      title: cleanText(txt(channel.title)),
      link: absolutize(channelLink, baseUrl),
      description: cleanText(txt(channel.description)),
      image: absolutize(txt(channel.image?.url) || channel['itunes:image']?.['@href'] || '', baseUrl),
      language: txt(channel.language),
      items: items.map((it) => {
        const html = txt(it['content:encoded']) || txt(it.description);
        const link = arr(it.link).map((l) => txt(l)).find(Boolean) || txt(it.guid);
        return {
          title: cleanText(stripHtml(txt(it.title))),
          link: absolutize(link, baseUrl),
          description: cleanText(stripHtml(txt(it.description) || html)),
          image: absolutize(mediaImage(it) || firstImageInHtml(html), baseUrl),
          author: cleanText(txt(it['dc:creator']) || txt(it.author)),
          category: cleanText(txt(arr(it.category)[0])),
          pubDate: normalizeDate(txt(it.pubDate) || txt(it['dc:date'])),
        };
      }),
    };
  }

  if (doc.feed) {
    const feed = doc.feed;
    return {
      title: cleanText(txt(feed.title)),
      link: absolutize(atomLink(feed) || baseUrl, baseUrl),
      description: cleanText(txt(feed.subtitle)),
      image: absolutize(txt(feed.logo) || txt(feed.icon), baseUrl),
      language: feed['@xml:lang'] || '',
      items: arr(feed.entry).map((e) => {
        const html = txt(e.content) || txt(e.summary);
        return {
          title: cleanText(stripHtml(txt(e.title))),
          link: absolutize(atomLink(e) || txt(e.id), baseUrl),
          description: cleanText(stripHtml(txt(e.summary) || html)),
          image: absolutize(mediaImage(e) || firstImageInHtml(html), baseUrl),
          author: cleanText(arr(e.author).map((a) => txt(a?.name) || txt(a)).filter(Boolean).join(', ')),
          category: cleanText(arr(e.category)[0]?.['@term'] || ''),
          pubDate: normalizeDate(txt(e.published) || txt(e.updated)),
        };
      }),
    };
  }

  throw new Error('Document is not an RSS, Atom or JSON feed');
}

/** Last-ditch regex/cheerio parse for feeds too broken for an XML parser. */
function parseFeedLoose(text, baseUrl, originalErr) {
  const $ = cheerio.load(text, { xmlMode: true });
  const nodes = $('item').length ? $('item') : $('entry');
  if (!nodes.length) throw originalErr || new Error('Unparseable feed');
  const items = nodes
    .map((_, el) => {
      const $el = $(el);
      const html = $el.find('content\\:encoded').text() || $el.find('description').text() || $el.find('content').text();
      const link = $el.find('link').attr('href') || $el.find('link').first().text() || $el.find('guid').text();
      return {
        title: cleanText(stripHtml($el.find('title').first().text())),
        link: absolutize(link.trim(), baseUrl),
        description: cleanText(stripHtml(html)),
        image: absolutize($el.find('media\\:content, media\\:thumbnail, enclosure').attr('url') || firstImageInHtml(html), baseUrl),
        author: cleanText($el.find('dc\\:creator, author name, author').first().text()),
        category: cleanText($el.find('category').first().text() || $el.find('category').attr('term') || ''),
        pubDate: normalizeDate($el.find('pubDate, published, updated, dc\\:date').first().text()),
      };
    })
    .get();
  return {
    title: cleanText($('channel > title, feed > title').first().text()),
    link: baseUrl,
    description: cleanText($('channel > description, feed > subtitle').first().text()),
    image: '',
    language: $('channel > language').first().text(),
    items,
  };
}

/** Parse a sitemap; returns {type:'index', sitemaps:[url]} or {type:'urlset', items:[...]} */
function parseSitemap(text, baseUrl) {
  const doc = parser.parse(sanitizeXml(text));
  if (doc.sitemapindex) {
    const maps = arr(doc.sitemapindex.sitemap).map((s) => ({ loc: txt(s.loc), lastmod: normalizeDate(txt(s.lastmod)) }));
    maps.sort((a, b) => String(b.lastmod).localeCompare(String(a.lastmod)));
    return { type: 'index', sitemaps: maps.map((m) => absolutize(m.loc, baseUrl)).filter(Boolean) };
  }
  const urls = arr(doc.urlset?.url);
  const items = urls
    .map((u) => {
      const news = u['news:news'] || {};
      const img = arr(u['image:image'])[0];
      return {
        title: cleanText(txt(news['news:title']) || txt(img?.['image:title'])),
        link: absolutize(txt(u.loc), baseUrl),
        description: '',
        image: absolutize(txt(img?.['image:loc']), baseUrl),
        author: '',
        category: cleanText(txt(news['news:keywords']).split(',')[0] || ''),
        pubDate: normalizeDate(txt(news['news:publication_date']) || txt(u.lastmod)),
        _isNews: Boolean(u['news:news']),
      };
    })
    .filter((i) => i.link);
  items.sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)));
  return { type: 'urlset', items };
}

/* ---------------- RSS generation ---------------- */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function buildRss({ publication, articles, selfUrl }) {
  const items = dedupeArticles(articles)
    .map((a) => {
      const parts = [
        `<title>${esc(a.title)}</title>`,
        `<link>${esc(a.link)}</link>`,
        `<guid isPermaLink="true">${esc(a.link)}</guid>`,
      ];
      if (a.description) parts.push(`<description>${esc(a.description)}</description>`);
      if (a.pubDate) {
        const d = new Date(a.pubDate);
        if (!Number.isNaN(d.getTime())) parts.push(`<pubDate>${d.toUTCString()}</pubDate>`);
      }
      if (a.author) parts.push(`<dc:creator>${esc(a.author)}</dc:creator>`);
      if (a.category) parts.push(`<category>${esc(a.category)}</category>`);
      if (a.image) parts.push(`<media:content url="${esc(a.image)}" medium="image"/>`);
      return `    <item>\n      ${parts.join('\n      ')}\n    </item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(publication.name)}</title>
    <link>${esc(publication.url)}</link>
    <description>${esc(publication.description || `Latest stories from ${publication.name}`)}</description>
    <language>${esc(publication.language || 'en')}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>855pm newsletter builder</generator>${selfUrl ? `\n    <atom:link href="${esc(selfUrl)}" rel="self" type="application/rss+xml"/>` : ''}${
    publication.logo ? `\n    <image><url>${esc(publication.logo)}</url><title>${esc(publication.name)}</title><link>${esc(publication.url)}</link></image>` : ''
  }
${items}
  </channel>
</rss>
`;
}

/* ---------------- Source resolution: URL -> articles ---------------- */

// Common feed locations, tried when a page advertises no feed.
const FEED_PATHS = ['/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/feeds/posts/default', '/?feed=rss2', '/rss/home', '/rssfeeds'];
// Publishers whose feeds live on another host and are not linked from the site.
const KNOWN_FEEDS = {
  'bbc.com': ['https://feeds.bbci.co.uk/news/rss.xml'],
  'bbc.co.uk': ['https://feeds.bbci.co.uk/news/rss.xml'],
  'timesofindia.indiatimes.com': ['https://timesofindia.indiatimes.com/rssfeedstopstories.cms'],
};
const SITEMAP_PATHS = ['/news-sitemap.xml', '/sitemap_news.xml', '/sitemap-news.xml', '/news_sitemap.xml', '/sitemap.xml'];
const MIN_ARTICLES = 5;

/** "/business/story/sensex-jumps-500-points-2601234" -> "Sensex jumps 500 points" */
function titleFromSlug(link) {
  try {
    const segs = new URL(link).pathname.split('/').filter(Boolean);
    const slug = [...segs].reverse().find((x) => (x.match(/-/g) || []).length >= 2) || segs.pop() || '';
    const words = decodeURIComponent(slug)
      .replace(/\.(html?|cms|ece|php|aspx)$/i, '')
      .split(/[-_]+/)
      .filter((w) => w && !/^\d{5,}$/.test(w) && !/^(19|20)\d{2}$/.test(w) && !/^\d{1,2}$/.test(w) && !/^[a-z]*\d+[a-z\d]*$/i.test(w));
    const t = words.join(' ');
    return t.length >= 12 ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  } catch {
    return '';
  }
}

function knownFeedsFor(pageUrl) {
  const host = hostnameOf(pageUrl).replace(/^www\./, '');
  const key = Object.keys(KNOWN_FEEDS).find((h) => host === h || host.endsWith('.' + h));
  return key ? KNOWN_FEEDS[key] : [];
}

/** Fetch one URL as a feed. Resolves to the parsed feed, or throws. */
async function fetchFeed(url, opts = {}) {
  const res = await fetchText(url, { accept: FEED_ACCEPT, retries: 1, ...opts });
  if (!looksLikeFeed(res.text, res.contentType)) {
    const err = new Error(`Not a feed: ${url}`);
    // An HTML "RSS feeds" index page: keep it so its feed links can be tried.
    if (/<html|<a\s/i.test(res.text)) err.page = { url: res.url, text: res.text };
    throw err;
  }
  const feed = parseFeed(res.text, res.url);
  feed.items = dedupeArticles(feed.items);
  if (!feed.items.length) throw new Error(`Feed has no items: ${url}`);
  return { ...feed, feedUrl: res.url };
}

/** Try candidate feed URLs in order (a few at a time); first usable feed wins. */
async function firstWorkingFeed(urls, log, opts, directories = []) {
  const unique = [...new Set(urls.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 4) {
    const batch = unique.slice(i, i + 4);
    const results = await Promise.all(
      batch.map((u) =>
        fetchFeed(u, opts).then(
          (f) => (log.push({ step: 'feed', url: u, ok: true, items: f.items.length }), f),
          (e) => (log.push({ step: 'feed', url: u, ok: false, error: e.message }), e.page && /rss|feed/i.test(u) && directories.push(e.page), null)
        )
      )
    );
    const hit = results.find(Boolean);
    if (hit) return hit;
  }
  return null;
}

async function articlesFromSitemaps(siteUrl, robotsText, log, opts) {
  const fromRobots = [...String(robotsText || '').matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => absolutize(m[1], siteUrl)).filter(Boolean);
  // News sitemaps first: they carry titles and dates.
  const cands = [...new Set([...fromRobots.sort((a, b) => /news/i.test(b) - /news/i.test(a)), ...SITEMAP_PATHS.map((p) => new URL(p, siteUrl).toString())])].slice(0, 6);
  for (const url of cands) {
    try {
      const res = await fetchText(url, { accept: 'application/xml, text/xml;q=0.9, */*;q=0.5', retries: 1, ...opts });
      if (!looksLikeSitemap(res.text)) throw new Error('Not a sitemap');
      let map = parseSitemap(res.text, res.url);
      if (map.type === 'index') {
        const child = map.sitemaps.find((u) => /news/i.test(u)) || map.sitemaps[0];
        if (!child) throw new Error('Empty sitemap index');
        const cres = await fetchText(child, { retries: 1, ...opts });
        map = parseSitemap(cres.text, cres.url);
      }
      const items = (map.items || [])
        .map((it) => ({ ...it, title: it.title || titleFromSlug(it.link) }))
        .filter((it) => it.title && extract.looksLikeArticleUrl(it.link));
      log.push({ step: 'sitemap', url, ok: items.length > 0, items: items.length });
      if (items.length) return items.slice(0, 40).map(({ _isNews, ...a }) => a);
    } catch (e) {
      log.push({ step: 'sitemap', url, ok: false, error: e.message });
    }
  }
  return [];
}

/** Fill missing images / descriptions by visiting the top article pages. */
async function enrichArticles(articles, { limit = 12, concurrency = 4, ...opts } = {}) {
  const todo = articles.slice(0, limit).filter((a) => !a.image || !a.description || !a.pubDate);
  await mapLimit(todo, concurrency, async (a) => {
    const res = await fetchText(a.link, { retries: 0, timeout: 10000, ...opts });
    const m = extract.extractArticleMeta(res.text, res.url);
    if (!a.title || a.title.length < 15) a.title = m.title || a.title;
    a.image ||= m.image;
    a.description ||= truncate(m.description, 320);
    a.author ||= m.author;
    a.category ||= m.category;
    a.pubDate ||= m.pubDate;
  });
  return articles;
}

/**
 * Turn whatever the publisher typed (a feed URL or a plain website URL) into
 * a publication + article list, generating RSS when the site has none.
 *
 * Order: direct feed -> advertised feeds -> common feed paths -> scraping the
 * page (plain HTTP, then headless browser) -> sitemaps -> Groq. Each step is
 * recorded in `attempts` so the UI can explain what happened.
 *
 * @returns {Promise<{source:'feed'|'scrape'|'sitemap'|'llm', publication:object, articles:object[], feedUrl:string, rss:string, attempts:object[]}>}
 */
async function resolveSource(input, { limit = 25, enrich = true, fetchOptions = {} } = {}) {
  const url = normalizeUrl(input);
  const attempts = [];
  const opts = fetchOptions;
  let page = null;
  let pageErr = null;

  try {
    page = await fetchText(url, { accept: `text/html,application/xhtml+xml,${FEED_ACCEPT}`, ...opts });
    attempts.push({ step: 'page', url, ok: true, via: page.via, status: page.status });
  } catch (e) {
    pageErr = e;
    attempts.push({ step: 'page', url, ok: false, error: e.message, blocked: e.blocked });
  }

  // 1. The URL itself is a feed.
  if (page && looksLikeFeed(page.text, page.contentType)) {
    try {
      const feed = parseFeed(page.text, page.url);
      feed.items = dedupeArticles(feed.items);
      if (feed.items.length) return finish('feed', publicationFromFeed(feed, page.url), await enrichFeedItems(feed.items), page.url);
    } catch (e) {
      attempts.push({ step: 'parse', url: page.url, ok: false, error: e.message });
    }
  }

  // A blocked/failed plain fetch gets one headless try before we give up on the page.
  if ((!page || !/<html|<body|<a\s/i.test(page.text)) && !looksLikeFeed(page?.text || '')) {
    try {
      page = await fetchRendered(url);
      attempts.push({ step: 'page', url, ok: true, via: 'headless', status: page.status });
    } catch (e) {
      attempts.push({ step: 'page', url, ok: false, via: 'headless', error: e.message });
    }
  }

  const baseUrl = page?.url || url;
  const $ = page && !looksLikeFeed(page.text) ? cheerio.load(page.text) : null;
  const publication = $ ? extract.extractPublication($, baseUrl) : fallbackPublication(baseUrl);
  const siteRoot = new URL('/', baseUrl).toString();

  // 2. Feeds the page advertises, then 3. well-known feed paths.
  const advertised = $ ? extract.extractFeedLinks($, baseUrl) : [];
  const guessed = FEED_PATHS.map((p) => new URL(p, siteRoot).toString());
  const directories = [];
  let feed = await firstWorkingFeed([...knownFeedsFor(baseUrl), ...advertised.slice(0, 6), ...guessed], attempts, opts, directories);
  // 3b. Pages like /rss or /rss.cms that list the site's feeds.
  if (!feed && directories.length) {
    const listed = directories.flatMap((d) => extract.feedsFromDirectory(d.text, d.url));
    feed = await firstWorkingFeed(listed.slice(0, 8), attempts, opts);
  }
  if (feed) {
    const fromFeed = publicationFromFeed(feed, baseUrl);
    return finish('feed', { ...fromFeed, ...pick(publication, ['logo', 'favicon', 'themeColor']), name: publication.name || fromFeed.name }, await enrichFeedItems(feed.items), feed.feedUrl);
  }

  // 4. Scrape the page.
  let articles = $ ? extract.extractArticlesFromHtml($, baseUrl, { limit }) : [];
  if ($) attempts.push({ step: 'scrape', url: baseUrl, ok: articles.length > 0, items: articles.length, via: page.via });
  if (articles.length < MIN_ARTICLES && page?.via === 'http') {
    try {
      const rendered = await fetchRendered(url);
      const more = extract.extractArticlesFromHtml(rendered.text, rendered.url, { limit });
      attempts.push({ step: 'scrape', url, ok: more.length > 0, items: more.length, via: 'headless' });
      if (more.length > articles.length) articles = more;
    } catch (e) {
      attempts.push({ step: 'scrape', url, ok: false, via: 'headless', error: e.message });
    }
  }
  let source = 'scrape';

  // 5. Sitemaps are rarely behind bot walls.
  if (articles.length < MIN_ARTICLES) {
    let robots = '';
    try {
      robots = (await fetchText(new URL('/robots.txt', siteRoot).toString(), { retries: 0, ...opts })).text;
    } catch {
      /* no robots.txt */
    }
    const fromMap = await articlesFromSitemaps(siteRoot, robots, attempts, opts);
    if (fromMap.length > articles.length) {
      articles = dedupeArticles([...articles, ...fromMap]).slice(0, limit);
      source = 'sitemap';
    }
  }

  // 6. Let the LLM read the link list.
  if (articles.length < MIN_ARTICLES && page && groq.enabled()) {
    try {
      const picked = await groq.extractArticlesWithLlm(extract.pageDigestForLlm(page.text, baseUrl), baseUrl);
      const llm = picked
        .map((a) => ({ title: cleanText(a.title), link: absolutize(a.link, baseUrl), description: '', image: '', author: '', category: cleanText(a.category), pubDate: '' }))
        .filter((a) => a.link);
      attempts.push({ step: 'llm', url: baseUrl, ok: llm.length > 0, items: llm.length });
      if (llm.length > articles.length) {
        articles = dedupeArticles(llm).slice(0, limit);
        source = 'llm';
      }
    } catch (e) {
      attempts.push({ step: 'llm', url: baseUrl, ok: false, error: e.message });
    }
  }

  if (!articles.length) {
    const blocked = pageErr?.blocked || attempts.some((a) => a.blocked);
    const err = new Error(
      blocked
        ? `${hostnameOf(url)} blocks automated access and publishes no reachable feed or sitemap. Paste the site's RSS feed URL instead.`
        : `Could not find any articles on ${hostnameOf(url)}. Check the URL, or paste the site's RSS feed URL.`
    );
    err.attempts = attempts;
    err.code = blocked ? 'BLOCKED' : 'NO_ARTICLES';
    throw err;
  }

  if (enrich) {
    await enrichArticles(articles, opts).catch(() => {});
  }
  return finish(source, publication, articles, '');

  // Some feeds (TechCrunch, NDTV) ship no images; take them from the article pages.
  async function enrichFeedItems(items) {
    const list = dedupeArticles(items).slice(0, limit);
    if (enrich && list.some((a) => !a.image)) {
      await enrichArticles(list, { ...opts, limit, concurrency: 6 }).catch(() => {});
    }
    return list;
  }

  function finish(src, pub, items, feedUrl) {
    const list = dedupeArticles(items).slice(0, limit);
    return {
      source: src,
      publication: pub,
      articles: list,
      feedUrl,
      rss: buildRss({ publication: pub, articles: list, selfUrl: feedUrl || undefined }),
      attempts,
    };
  }
}

function publicationFromFeed(feed, pageUrl) {
  const url = feed.link || new URL('/', pageUrl).toString();
  const host = hostnameOf(url);
  // "India Today | Home" -> "India Today"
  const name = (feed.title || '').split(/\s+[|\-–—:]\s+/)[0].trim() || prettyNameFromHost(host);
  return { name, url, description: feed.description || '', logo: feed.image || '', favicon: '', themeColor: '', language: (feed.language || '').slice(0, 5) };
}

function fallbackPublication(pageUrl) {
  const host = hostnameOf(pageUrl);
  return { name: prettyNameFromHost(host), url: new URL('/', pageUrl).toString(), description: '', logo: '', favicon: new URL('/favicon.ico', pageUrl).toString(), themeColor: '', language: '' };
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k]).map((k) => [k, o[k]]));

module.exports = {
  parseFeed,
  parseSitemap,
  buildRss,
  looksLikeFeed,
  looksLikeSitemap,
  sanitizeXml,
  fetchFeed,
  resolveSource,
  enrichArticles,
  titleFromSlug,
};
