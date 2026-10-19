'use strict';
/**
 * HTML extraction: publication branding, feed autodiscovery links, article
 * lists (JSON-LD + DOM heuristics) and single-article metadata.
 */
const cheerio = require('cheerio');
const { cleanText, absolutize, hostnameOf, prettyNameFromHost, normalizeDate, dedupeArticles, truncate } = require('./util');

const SOCIAL_HOSTS = /(^|\.)(facebook|twitter|x|instagram|linkedin|youtube|whatsapp|telegram|pinterest|t|reddit|threads|google|apple|play\.google)\.(com|me|net)$/i;
const NON_ARTICLE_PATH =
  /\/(tag|tags|topic|topics|category|categories|author|authors|section|sections|search|login|signin|signup|register|subscribe|subscription|account|privacy|privacy-policy|terms|terms-of-use|about|about-us|contact|contact-us|careers|advertise|newsletter|newsletters|rss|feeds?|sitemap|cookie-policy|disclaimer|faq|help|shop|store|page)(\/|$)/i;
const ARTICLE_HINT = /(story|article|headline|title|card|post|news|entry|teaser|lead|top|item)/i;

function jsonLdBlocks($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Some sites ship several objects or trailing commas; try a lenient fix.
      try {
        out.push(JSON.parse(raw.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F]+/g, ' ')));
      } catch {
        /* ignore malformed block */
      }
    }
  });
  const flat = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== 'object') return;
    flat.push(node);
    if (node['@graph']) walk(node['@graph']);
    if (node.mainEntity) walk(node.mainEntity);
    if (node.itemListElement) walk(node.itemListElement);
    if (node.item && typeof node.item === 'object') walk(node.item);
  };
  out.forEach(walk);
  return flat;
}

const typeOf = (n) => [].concat(n['@type'] || []).map(String);
const ldImage = (img) => {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return ldImage(img[0]);
  return img.url || img.contentUrl || '';
};

const LOGO_HINT = /logo|brand|masthead|site-?title|wordmark|nameplate/i;

/** Best image URL of an <img>: lazy-load attributes and the largest srcset entry count too. */
function imgSrc($img, pageUrl) {
  const srcset = $img.attr('srcset') || $img.attr('data-srcset') || '';
  const best = srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/))
    .filter(([u]) => u)
    .sort((a, b) => (parseFloat(b[1]) || 1) - (parseFloat(a[1]) || 1))[0]?.[0];
  const src = [$img.attr('src'), $img.attr('data-src'), $img.attr('data-lazy-src'), $img.attr('data-original'), best].find((u) => u && !/^data:image\/(gif|png);base64,.{0,200}$/i.test(u));
  return absolutize(src || '', pageUrl);
}

/** An inline <svg> logo as a data: URL (rasterised later). */
function inlineSvg($, el) {
  const svg = $(el).clone();
  if (!svg.attr('xmlns')) svg.attr('xmlns', 'http://www.w3.org/2000/svg');
  // <use href="#id"> needs the referenced symbol inside the same document.
  svg.find('use').each((_, u) => {
    const ref = ($(u).attr('href') || $(u).attr('xlink:href') || '').replace(/^#/, '');
    const sym = ref && $(`[id="${ref}"]`).first();
    if (!sym || !sym.length) return;
    // A <symbol> carries the drawing's viewBox; the <svg> using it is often sized only by CSS.
    if (!svg.attr('viewBox') && sym.attr('viewBox') && svg.find('use').length === 1) svg.attr('viewBox', sym.attr('viewBox'));
    $(u).replaceWith(`<g>${sym.html()}</g>`);
  });
  const xml = $.html(svg);
  return xml.length < 200000 ? `data:image/svg+xml;base64,${Buffer.from(xml).toString('base64')}` : '';
}

/**
 * Masthead logo candidates, best first: structured data, logo-looking images
 * and inline SVGs in the header, meta tags. `icons` are square app icons,
 * used only when nothing better works.
 */
function logoCandidatesFrom($, pageUrl, structured = []) {
  const logos = [];
  const add = (u) => {
    const abs = u && (u.startsWith('data:') ? u : absolutize(u, pageUrl));
    if (abs && !logos.includes(abs)) logos.push(abs);
  };
  structured.forEach(add);
  add($('meta[property="og:logo"], meta[itemprop="logo"]').attr('content'));
  add($('[itemprop="logo"]').find('img').addBack('img').attr('src'));

  const scopes = 'header, [role=banner], .header, #header, .masthead, [class*="header" i], body';
  const logoish = (el) => {
    const $el = $(el);
    const own = [$el.attr('class'), $el.attr('id'), $el.attr('alt'), $el.attr('title'), $el.attr('aria-label')].join(' ');
    const link = $el.closest('a');
    const linkInfo = [link.attr('class'), link.attr('id'), link.attr('aria-label'), link.attr('title')].join(' ');
    let homeLink = false;
    try {
      homeLink = link.length && new URL(link.attr('href') || '', pageUrl).pathname.replace(/\/+$/, '') === '';
    } catch {}
    const parentInfo = $el.parents().slice(0, 3).map((_, p) => `${$(p).attr('class') || ''} ${$(p).attr('id') || ''}`).get().join(' ');
    return LOGO_HINT.test(own) || LOGO_HINT.test(linkInfo) || LOGO_HINT.test(parentInfo) || homeLink;
  };
  for (const scope of scopes.split(', ')) {
    $(scope).first().find('img, svg').each((_, el) => {
      if (logos.length >= 8 || !logoish(el)) return;
      if (el.tagName === 'svg') {
        if ($(el).closest('button').length || $(el).find('path, text, use, image').length === 0) return;
        add(inlineSvg($, el));
      } else add(imgSrc($(el), pageUrl));
    });
    if (logos.length) break;
  }

  const icons = [];
  $('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="icon"][sizes], link[rel="mask-icon"]').each((_, el) => {
    const u = absolutize($(el).attr('href'), pageUrl);
    if (u && !icons.includes(u)) icons.push(u);
  });
  return { logos, icons };
}

/** Branding + metadata about the publication. */
function extractPublication($, pageUrl) {
  const meta = (sel) => cleanText($(sel).attr('content'));
  const ld = jsonLdBlocks($);
  const org = ld.find((n) => typeOf(n).some((t) => /^(NewsMediaOrganization|Organization|WebSite)$/.test(t)) && n.name);
  const pub = ld.map((n) => n.publisher).find((p) => p && p.name);
  const host = hostnameOf(pageUrl);
  const rawTitle = cleanText($('title').first().text());
  // "Latest News | Example Times" -> "Example Times" (shortest meaningful segment from the edges)
  const segments = rawTitle.split(/\s+[|\-–—:]\s+/).map((s) => s.trim()).filter(Boolean);
  const titleName = segments.length > 1 ? [segments[0], segments[segments.length - 1]].sort((a, b) => a.length - b.length)[0] : rawTitle;
  const name = meta('meta[property="og:site_name"]') || org?.name || pub?.name || (titleName && titleName.length < 60 ? titleName : '') || prettyNameFromHost(host);

  const { logos, icons } = logoCandidatesFrom($, pageUrl, [ldImage(org?.logo), ldImage(pub?.logo)]);
  const favicon = absolutize($('link[rel~="icon"]').attr('href') || '/favicon.ico', pageUrl);

  return {
    name: cleanText(name),
    url: new URL('/', pageUrl).toString(),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    logo: logos[0] || '',
    logoCandidates: logos,
    iconCandidates: icons,
    favicon,
    themeColor: (meta('meta[name="theme-color"]') || '').match(/^#[0-9a-f]{3,8}$/i)?.[0] || '',
    language: ($('html').attr('lang') || meta('meta[property="og:locale"]') || '').slice(0, 5),
  };
}

/** <link rel=alternate> feeds plus obvious RSS anchors. */
function extractFeedLinks($, pageUrl) {
  const links = [];
  $('link[rel~="alternate"]').each((_, el) => {
    const type = ($(el).attr('type') || '').toLowerCase();
    if (/(rss|atom|feed\+json|rdf)/.test(type)) links.push(absolutize($(el).attr('href'), pageUrl));
  });
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (/(\.rss|\.xml|\/rss\/?|\/feed\/?|feeds?\.)/i.test(href) && !/sitemap/i.test(href)) links.push(absolutize(href, pageUrl));
  });
  return [...new Set(links.filter(Boolean))];
}

/**
 * Feed URLs listed on an "RSS feeds" index page (e.g. /rss, /rss.cms), most
 * general first. Unwraps "add to reader" links like ...?url=<feed>.
 */
function feedsFromDirectory(html, pageUrl) {
  const $ = typeof html === 'string' ? cheerio.load(html) : html;
  const self = pageUrl.replace(/[#?].*$/, '').replace(/\/$/, '');
  const links = new Set();
  $('a[href], link[rel~="alternate"][href]').each((_, el) => {
    let href = absolutize($(el).attr('href'), pageUrl);
    if (!href) return;
    try {
      const wrapped = new URL(href).searchParams.get('url');
      if (wrapped && /^https?:\/\//i.test(wrapped)) href = wrapped;
    } catch {
      return;
    }
    href = href.replace(/#.*$/, '');
    if (!/(rss|feed|atom|\.xml)/i.test(href) || /(sitemap|feedback)/i.test(href)) return;
    if (href.replace(/\/$/, '') === self || !sameSite(href, hostnameOf(pageUrl))) return;
    links.add(href);
  });
  const rank = (u) => (/(top|home|latest|main|default|news|recent)/i.test(u) ? 0 : 1);
  return [...links].sort((a, b) => rank(a) - rank(b));
}

function bestImgSrc($, img) {
  const $img = $(img);
  const srcset = $img.attr('data-srcset') || $img.attr('srcset') || '';
  const fromSet = srcset
    .split(',')
    .map((s) => s.trim().split(/\s+/))
    .filter((p) => p[0])
    .sort((a, b) => (parseInt(b[1]) || 0) - (parseInt(a[1]) || 0))[0]?.[0];
  const cands = [
    $img.attr('data-src'),
    $img.attr('data-lazy-src'),
    $img.attr('data-original'),
    $img.attr('data-lazy'),
    $img.attr('data-url'),
    fromSet,
    $img.attr('src'),
  ];
  return cands.find((s) => s && !/^data:/i.test(s) && !/(blank|spacer|placeholder|pixel|transparent|loader|lazy)\.(gif|png|svg)/i.test(s)) || '';
}

function isUsableImage(src, $img) {
  if (!src) return false;
  if (/\.svg(\?|$)/i.test(src)) return false;
  if (/(logo|icon|avatar|sprite|badge|emoji|1x1|tracking)/i.test(src)) return false;
  const w = parseInt($img?.attr('width')) || 0;
  const h = parseInt($img?.attr('height')) || 0;
  if ((w && w < 80) || (h && h < 60)) return false;
  return true;
}

function sameSite(link, baseHost) {
  const h = hostnameOf(link);
  if (!h) return false;
  const root = (x) => x.split('.').slice(-2).join('.');
  return h === baseHost || h.endsWith('.' + baseHost) || root(h) === root(baseHost);
}

const BLOCK_TAGS = /^(div|section|p|h[1-6]|li|ul|ol|figure|figcaption|header|footer|article|aside|time|br)$/i;

/**
 * Headline text of a teaser anchor. Card anchors often wrap a section label,
 * the headline and a summary in separate elements; .text() would glue them
 * together ("Real Estate1861 Texas home...").
 */
function anchorText($, a) {
  const $a = $(a);
  const heading = cleanText($a.find('h1,h2,h3,h4,h5,h6,[class*="headline" i],[data-testid*="headline" i]').first().text());
  if (heading.length >= 20) return heading;
  const blocks = new Map();
  const walk = (node, block) => {
    for (const c of node.children || []) {
      if (c.type === 'text') {
        const prev = blocks.get(block) || '';
        const t = c.data || '';
        // Adjacent inline elements with no whitespace: "LIVE" + "Fresh flood..."
        const gap = /[A-Za-z0-9]$/.test(prev) && /^[A-Z0-9]/.test(t) ? ' ' : '';
        blocks.set(block, prev + gap + t);
      } else if (c.type === 'tag' && !/^(script|style|noscript|svg)$/i.test(c.name)) {
        walk(c, BLOCK_TAGS.test(c.name) ? c : block);
      }
    }
  };
  walk(a, a);
  const pieces = [...blocks.values()].map(cleanText).filter(Boolean);
  if (pieces.length <= 1) return pieces[0] || '';
  return pieces.find((p) => p.length >= 20 && p.split(/\s+/).length >= 4) || pieces.join(' ');
}

function scoreLink(link, text, $a) {
  let score = 0;
  let path;
  try {
    path = new URL(link).pathname;
  } catch {
    return -1;
  }
  if (path === '/' || path === '') return -1;
  if (NON_ARTICLE_PATH.test(path)) return -1;
  const words = text.split(/\s+/).length;
  if (text.length < 20 || words < 4) return -1;
  if (text.length > 220) score -= 2;
  const segs = path.split('/').filter(Boolean);
  const last = segs[segs.length - 1] || '';
  if (segs.length >= 2) score += 1;
  if (/\d{4,}/.test(path)) score += 2; // ids, dates
  if (/\/20\d{2}\/\d{1,2}\//.test(path)) score += 2;
  if ((last.match(/-/g) || []).length >= 3) score += 2;
  if (/\.(html?|cms|ece|php|aspx)$/i.test(last)) score += 1;
  if (words >= 6) score += 1;
  const ctx = $a.parents().slice(0, 6);
  if (ctx.filter('nav, footer, header, aside, [role="navigation"], [class*="menu" i], [class*="footer" i], [class*="nav" i]').length) score -= 4;
  if (ctx.filter('article, h1, h2, h3, h4').length || $a.parent().is('h1,h2,h3,h4')) score += 2;
  if (ctx.toArray().some((el) => ARTICLE_HINT.test(`${el.attribs?.class || ''} ${el.attribs?.id || ''}`))) score += 1;
  return score;
}

/** Extract a ranked list of article teasers from a listing/home page. */
function extractArticlesFromHtml(html, pageUrl, { limit = 25 } = {}) {
  const $ = typeof html === 'string' ? cheerio.load(html) : html;
  const baseHost = hostnameOf(pageUrl);
  const found = [];

  // 1. Structured data is the most reliable signal.
  for (const n of jsonLdBlocks($)) {
    const types = typeOf(n);
    if (types.some((t) => /(NewsArticle|Article|BlogPosting|ReportageNews|AnalysisNewsArticle|LiveBlogPosting)$/.test(t)) && (n.url || n.mainEntityOfPage) && n.headline) {
      const link = absolutize(n.url || n.mainEntityOfPage?.['@id'] || n.mainEntityOfPage, pageUrl);
      if (link && link.replace(/\/$/, '') !== pageUrl.replace(/\/$/, '')) {
        found.push({
          title: cleanText(n.headline),
          link,
          description: cleanText(n.description),
          image: absolutize(ldImage(n.image) || ldImage(n.thumbnailUrl), pageUrl),
          author: cleanText([].concat(n.author || [])[0]?.name || ''),
          category: cleanText(n.articleSection && [].concat(n.articleSection)[0]),
          pubDate: normalizeDate(n.datePublished),
          _score: 10,
        });
      }
    } else if (types.includes('ListItem') && (n.url || n.item?.url) && (n.name || n.item?.name)) {
      found.push({
        title: cleanText(n.name || n.item.name),
        link: absolutize(n.url || n.item.url, pageUrl),
        description: '',
        image: absolutize(ldImage(n.image || n.item?.image), pageUrl),
        _score: 8,
      });
    }
  }

  // 2. DOM heuristics over every anchor.
  const byLink = new Map();
  $('a[href]').each((i, el) => {
    const $a = $(el);
    const link = absolutize($a.attr('href'), pageUrl);
    if (!link || !sameSite(link, baseHost) || SOCIAL_HOSTS.test(hostnameOf(link))) return;
    let text = cleanText($a.attr('title') && $a.text().trim().length < 15 ? $a.attr('title') : anchorText($, el));
    if (!text) text = cleanText($a.find('img').attr('alt'));
    const score = scoreLink(link, text, $a);
    const prev = byLink.get(link);
    // Image-only anchors often precede the headline anchor; remember their image.
    let image = '';
    let $box = $a;
    for (let d = 0; d < 4 && !image; d++) {
      $box.find('img').each((_, img) => {
        if (image) return;
        const src = absolutize(bestImgSrc($, img), pageUrl);
        if (isUsableImage(src, $(img))) image = src;
      });
      $box = $box.parent();
      if ($box.find('a[href]').length > 6) break; // walked into a whole list
    }
    let description = '';
    const $card = $a.closest('article, li, [class*="card" i], [class*="story" i], [class*="item" i], div');
    if ($card.length && $card.find('a[href]').length <= 4) {
      const p = $card.find('p').filter((_, x) => cleanText($(x).text()).length > 40).first();
      if (p.length && !cleanText(p.text()).startsWith(text.slice(0, 30))) description = cleanText(p.text());
    }
    if (prev) {
      if (score > prev._score) Object.assign(prev, { title: text, _score: score });
      prev.image ||= image;
      prev.description ||= description;
      return;
    }
    byLink.set(link, { title: text, link, description, image, author: '', category: '', pubDate: '', _score: score, _order: i });
  });

  const dom = [...byLink.values()].filter((a) => a._score >= 2);
  // Keep document order among good candidates so the top story stays on top.
  dom.sort((a, b) => b._score - a._score || a._order - b._order);
  const top = dom.slice(0, limit * 2).sort((a, b) => a._order - b._order);

  const merged = dedupeArticles([...found, ...top]);
  // Fill images/descriptions from DOM for JSON-LD items that lacked them.
  for (const a of merged) {
    const d = byLink.get(a.link);
    if (d) {
      a.image ||= d.image;
      a.description ||= d.description;
    }
  }
  return merged.slice(0, limit).map(({ _score, _order, ...a }) => ({ ...a, description: truncate(a.description || '', 320) }));
}

/** Metadata for one article page (used to enrich teasers). */
function extractArticleMeta(html, pageUrl) {
  const $ = cheerio.load(html);
  const meta = (sel) => cleanText($(sel).attr('content'));
  const ld = jsonLdBlocks($).find((n) => typeOf(n).some((t) => /Article|BlogPosting|ReportageNews/.test(t)));
  let image = meta('meta[property="og:image"]') || meta('meta[property="og:image:url"]') || meta('meta[name="twitter:image"]') || ldImage(ld?.image);
  const firstParagraph = $('article p, [itemprop="articleBody"] p, main p')
    .map((_, p) => cleanText($(p).text()))
    .get()
    .find((t) => t.length > 80);
  return {
    title: meta('meta[property="og:title"]') || cleanText(ld?.headline) || cleanText($('h1').first().text()),
    description: meta('meta[property="og:description"]') || meta('meta[name="description"]') || cleanText(ld?.description) || firstParagraph || '',
    image: absolutize(image, pageUrl),
    author: meta('meta[name="author"]') || cleanText([].concat(ld?.author || [])[0]?.name || ''),
    category: meta('meta[property="article:section"]') || cleanText(ld?.articleSection && [].concat(ld.articleSection)[0]),
    pubDate: normalizeDate(meta('meta[property="article:published_time"]') || ld?.datePublished),
  };
}

/** Cheap URL-only check used for sitemap entries, which carry no anchor text. */
function looksLikeArticleUrl(link) {
  let path;
  try {
    path = new URL(link).pathname;
  } catch {
    return false;
  }
  if (path === '/' || NON_ARTICLE_PATH.test(path) || /\.(xml|jpe?g|png|gif|webp|pdf)$/i.test(path)) return false;
  const last = path.split('/').filter(Boolean).pop() || '';
  return /\d{4,}/.test(path) || (last.match(/-/g) || []).length >= 2;
}

/** Compact text view of a page for the LLM fallback. */
function pageDigestForLlm(html, pageUrl, maxChars = 14000) {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, footer, nav').remove();
  const lines = [];
  $('a[href]').each((_, el) => {
    const text = cleanText($(el).text());
    const link = absolutize($(el).attr('href'), pageUrl);
    if (text.length >= 15 && link) lines.push(`${text} -> ${link}`);
  });
  return [...new Set(lines)].join('\n').slice(0, maxChars);
}

module.exports = { looksLikeArticleUrl, extractPublication, extractFeedLinks, feedsFromDirectory, anchorText, extractArticlesFromHtml, extractArticleMeta, pageDigestForLlm, jsonLdBlocks };
