'use strict';
/**
 * Publisher logos for the email masthead. Email clients need a raster image
 * with known dimensions on an https URL we control, so logos are downloaded
 * (or taken from the publisher's upload), SVGs are rasterised in headless
 * Chromium, and the result is stored and served next to the newsletter.
 */
const { httpFetch, getBrowser, PROFILES } = require('./fetcher');

const MAX_W = 240;
const MAX_H = 64;

/** Width/height/type of a PNG, JPEG, GIF or WebP buffer, or null. */
function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 3) === 'GIF') return { type: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { type: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { type: 'webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

const isSvg = (buf) => /<svg[\s>]/i.test(buf.slice(0, 2000).toString('utf8'));

/**
 * Inline SVG logos are often sized only by the site's CSS, with no viewBox or
 * width/height, and render as a 300x150 crop. Give them a viewBox from the
 * drawing's own bounding box first.
 */
async function fitSvg(page, svg) {
  if (/<svg[^>]*\sviewBox=/i.test(svg)) return svg;
  try {
    await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
    const box = await page.evaluate(() => {
      const el = document.querySelector('svg');
      el.setAttribute('width', '4000');
      el.setAttribute('height', '4000');
      const b = el.getBBox();
      return b.width && b.height ? [b.x, b.y, b.width, b.height] : null;
    });
    if (!box) return svg;
    return svg.replace(/<svg/i, `<svg viewBox="${box.map((n) => Math.round(n * 100) / 100).join(' ')}"`);
  } catch {
    return svg;
  }
}

/** Render an SVG to a transparent PNG about MAX_H*2 pixels tall. */
async function rasterizeSvg(svg) {
  const browser = await getBrowser();
  if (!browser) return null;
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  try {
    const html = `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;height:${MAX_H}px;width:auto;max-width:${MAX_W * 2}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(await fitSvg(page, svg)).toString('base64')}">`;
    await page.setContent(html);
    const img = page.locator('img');
    await img.waitFor({ timeout: 5000 });
    const png = await img.screenshot({ omitBackground: true, type: 'png' });
    return png;
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

/** Turn downloaded/uploaded bytes into { buffer, type, width, height } or null. */
async function normalizeLogo(buf) {
  if (!buf?.length) return null;
  if (isSvg(buf)) {
    const png = await rasterizeSvg(buf.toString('utf8'));
    if (!png) return null;
    buf = png;
  }
  const size = imageSize(buf);
  if (!size || !size.width || !size.height) return null;
  return { buffer: buf, ...size };
}

async function downloadLogo(url, { userAgent = PROFILES[0]['User-Agent'] } = {}) {
  const data = String(url || '').match(/^data:image\/[a-z+.-]+(;base64)?,(.*)$/is);
  if (data) return normalizeLogo(data[1] ? Buffer.from(data[2], 'base64') : Buffer.from(decodeURIComponent(data[2])));
  if (!/^https?:\/\//i.test(url || '')) return null;
  // One retry: image CDNs (Wikimedia especially) sometimes fail the first, uncached request.
  for (let tries = 0; tries < 2; tries++) {
    try {
      const res = await httpFetch(url, { headers: { 'User-Agent': userAgent, Accept: 'image/png,image/jpeg,image/svg+xml,image/*,*/*;q=0.5' }, signal: AbortSignal.timeout(15000) });
      if (res.ok) return await normalizeLogo(Buffer.from(await res.arrayBuffer()));
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      /* timeout or network error: retry once */
    }
  }
  return null;
}

/** Size the logo fits at in the masthead box. */
function displaySize({ width, height }) {
  const scale = Math.min(MAX_W / width, MAX_H / height, 1);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/* ---------------- Finding a publisher's logo ---------------- */

// Wikimedia asks for a UA that says who we are; anonymous ones are rate limited harder.
const WIKI_UA = 'NewsletterBuilder/1.0 (https://github.com/anupam-spec/855pm.in; publisher logo lookup)';
const wikiCache = new Map();
const bareHost = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

// A masthead logo is wide or at least reasonably sized; tracking pixels and spacers are not.
const usableLogo = (l) => l && l.width >= 40 && l.height >= 16 && l.width * l.height >= 2000;
const usableIcon = (l) => l && l.width >= 64 && l.height >= 64;

/**
 * Logo and name from Wikidata for a site, via its "official website" (P856)
 * and "logo image" (P154). Works when the site itself blocks us (WSJ, NYT).
 */
async function wikidataLogo(siteUrl) {
  const host = bareHost(siteUrl);
  if (!host) return null;
  if (!wikiCache.has(host)) {
    const lookup = lookupWikidata(host);
    wikiCache.set(host, lookup);
    // Keep answers for a day; forget failures so the next build tries again.
    lookup.then((r) => setTimeout(() => wikiCache.delete(host), r ? 86400e3 : 0).unref?.());
  }
  return wikiCache.get(host);
}

async function lookupWikidata(host) {
  const get = async (params) => {
    for (let tries = 0; tries < 3; tries++) {
      try {
        const res = await httpFetch(`https://www.wikidata.org/w/api.php?format=json&${new URLSearchParams(params)}`, {
          headers: { 'User-Agent': WIKI_UA },
          signal: AbortSignal.timeout(12000),
        });
        if (res.ok) return await res.json();
        if (res.status !== 429 && res.status < 500) return null;
        const wait = Number(res.headers.get('retry-after')) || 1;
        if (wait > 5) return null;
        await new Promise((r) => setTimeout(r, wait * 1000 + 250));
      } catch {
        /* network error: try again */
      }
    }
    return null;
  };
  try {
    const found = await get({ action: 'query', list: 'search', srlimit: '8', srsearch: `haswbstatement:P154 haswbstatement:P856 "${host}"` });
    const ids = (found?.query?.search || []).map((r) => r.title).filter((t) => /^Q\d+$/.test(t));
    if (!ids.length) return null;
    const ents = await get({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels', languages: 'en' });
    for (const id of ids) {
      const e = ents?.entities?.[id];
      const sites = (e?.claims?.P856 || []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean);
      if (!sites.some((u) => bareHost(u) === host)) continue;
      // Prefer the current logo (no end date) when several are listed.
      const logos = (e.claims.P154 || []).filter((c) => !c.qualifiers?.P582).concat(e.claims.P154 || []);
      const file = logos.map((c) => c.mainsnak?.datavalue?.value).find(Boolean);
      if (!file) continue;
      return { url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=600`, name: e.labels?.en?.value || '' };
    }
  } catch {
    /* Wikidata unreachable: fall through to icons */
  }
  return null;
}

/**
 * Best logo for a publication: candidates from its own page (structured data,
 * header images, inline SVG) and feed, then Wikidata, then its app icon or
 * favicon. Returns { logo, name, from } with `logo` normalised, or null.
 */
async function findLogo(publication, { log } = {}) {
  const site = publication.url;
  const tried = new Set();
  const attempt = async (url, ok, from, opts) => {
    if (!url || tried.has(url)) return null;
    tried.add(url);
    const l = await downloadLogo(url, opts);
    if (log) log.push({ from, url: url.startsWith('data:') ? 'inline svg' : url, ok: !!(l && ok(l)) });
    return l && ok(l) ? { logo: l, from } : null;
  };
  const candidates = [...(publication.logoCandidates || []), publication.logo].filter(Boolean).slice(0, 8);
  for (const url of candidates) {
    const hit = await attempt(url, usableLogo, 'site');
    if (hit) return hit;
  }
  const wiki = await wikidataLogo(site);
  if (wiki) {
    const hit = await attempt(wiki.url, usableLogo, 'wikidata', { userAgent: WIKI_UA });
    if (hit) return { ...hit, name: wiki.name };
  }
  const host = bareHost(site);
  const icons = [
    ...(publication.iconCandidates || []),
    site && new URL('/apple-touch-icon.png', site).toString(),
    host && `https://www.google.com/s2/favicons?domain=${host}&sz=256`,
  ];
  for (const url of icons) {
    const hit = await attempt(url, usableIcon, 'icon');
    if (hit) return { ...hit, name: wiki?.name };
  }
  return wiki?.name ? { logo: null, name: wiki.name, from: 'wikidata' } : null;
}

module.exports = { imageSize, normalizeLogo, downloadLogo, displaySize, findLogo, wikidataLogo };
