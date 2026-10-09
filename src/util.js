'use strict';

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return ENTITY_MAP[e.toLowerCase()] ?? m;
  });
}

function stripHtml(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function cleanText(s) {
  return decodeEntities(String(s ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s, n) {
  s = cleanText(s);
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const at = cut.lastIndexOf(' ');
  return (at > n * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—]+$/, '') + '…';
}

function absolutize(href, base) {
  if (!href) return '';
  href = String(href).trim();
  if (/^(javascript|mailto|tel|data):/i.test(href)) return '';
  try {
    const u = new URL(href.startsWith('//') ? 'https:' + href : href, base);
    if (!/^https?:$/.test(u.protocol)) return '';
    return u.toString();
  } catch {
    return '';
  }
}

function firstImageInHtml(html) {
  if (!html) return '';
  const m = /<img[^>]+(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i.exec(String(html));
  return m ? decodeEntities(m[1]) : '';
}

function normalizeDate(v) {
  if (!v) return '';
  const d = new Date(String(v).trim());
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** Normalise a user-typed URL ("example.com", "http://x", " https://y/ "). */
function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Please enter a URL');
  if (/^feed:/i.test(s)) s = s.replace(/^feed:(\/\/)?/i, 'https://');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`"${input}" is not a valid URL`);
  }
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') throw new Error(`"${input}" is not a valid URL`);
  u.hash = '';
  return u.toString();
}

function canonicalKey(link) {
  try {
    const u = new URL(link);
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|cmp$|src$)/i.test(p)) u.searchParams.delete(p);
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
  } catch {
    return String(link).toLowerCase();
  }
}

function dedupeArticles(list) {
  const seenLink = new Set();
  const seenTitle = new Set();
  const out = [];
  for (const a of list) {
    if (!a || !a.title || !a.link) continue;
    const lk = canonicalKey(a.link);
    const tk = a.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (seenLink.has(lk) || (tk && seenTitle.has(tk))) continue;
    seenLink.add(lk);
    if (tk) seenTitle.add(tk);
    out.push(a);
  }
  return out;
}

/** Run async fn over items with limited concurrency. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (err) {
        results[idx] = undefined;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function prettyNameFromHost(host) {
  const core = host.split('.').slice(0, -1).filter((p) => !['www', 'm', 'amp', 'co', 'com'].includes(p)).pop() || host;
  return core.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

module.exports = {
  decodeEntities,
  stripHtml,
  cleanText,
  truncate,
  absolutize,
  firstImageInHtml,
  normalizeDate,
  normalizeUrl,
  canonicalKey,
  dedupeArticles,
  mapLimit,
  escapeHtml,
  hostnameOf,
  prettyNameFromHost,
};
