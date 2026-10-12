'use strict';
/**
 * A publisher newsletter in any of the template formats, as the regular HTML
 * email and as a live AMP email.
 *
 * The AMP version is made from the same template: it is rendered once with
 * mustache placeholders in place of each story ({{s.3.title}}, ...) and the
 * build time ({{updated}}), converted to AMP markup and wrapped in an
 * <amp-list> that fetches /n/<id>/live.json every time the email is opened.
 * live.json returns the same number of stories the skeleton was built with,
 * so every slot fills.
 */
const cheerio = require('cheerio');
const zlib = require('zlib');
const { buildNewsletter } = require('./newsletter');
const templates = require('./templates');
const { formatDate } = require('./templates/shared');

const FORMATS = templates.list();
const DEFAULT_FORMAT = 'magazine';
const MAX_STORIES = 12;
const SENTINEL_DATE = '2001-02-03T04:05:00.000Z';
const STORY_FIELDS = ['title', 'link', 'summary', 'image', 'category'];

const formatId = (id) => (FORMATS.some((f) => f.id === id) ? id : DEFAULT_FORMAT);

/** Ad settings from the environment; placeholder boxes until a GAM network is set. */
function adOptions(env = process.env) {
  return {
    mode: env.ADS_MODE || 'placeholder',
    networkCode: env.GAM_NETWORK_CODE || '6499',
    adUnitPrefix: env.GAM_AD_UNIT_PREFIX || 'example/newsletter',
  };
}

function renderOpts(rec, base) {
  return {
    ads: adOptions(),
    accentColor: rec.publication.accent || '',
    webViewUrl: `${base}/n/${rec.id}/preview?format=${formatId(rec.format)}`,
    unsubscribeUrl: rec.publication.url || base,
  };
}

function publicationFor(rec, base) {
  return {
    name: rec.publication.name,
    url: rec.publication.url,
    logo: rec.logo ? `${base}/n/${rec.id}/logo?v=${rec.logo.version}` : '',
    logoWidth: rec.logo?.width,
    logoHeight: rec.logo?.height,
    description: rec.publication.description,
    accentColor: rec.publication.accent || '',
  };
}

/** Newsletter JSON (templates' input) for a stored newsletter. */
function newsletterFor(rec, base) {
  const nl = buildNewsletter({ publication: publicationFor(rec, base), articles: rec.articles }, { now: new Date(rec.builtAt), maxArticles: MAX_STORIES });
  Object.assign(nl.publication, { logoWidth: rec.logo?.width, logoHeight: rec.logo?.height });
  return nl;
}

function renderHtmlEmail(rec, base, format = rec.format) {
  return templates.render(formatId(format), newsletterFor(rec, base), renderOpts(rec, base));
}

/** Number of story slots in the AMP skeleton, fixed when the newsletter is first built. */
const slotCount = (rec) => Math.max(1, Math.min(MAX_STORIES, rec.slots || rec.articles.length));

/** Body of /n/<id>/live.json. */
function liveData(rec, base, format = rec.format) {
  const nl = newsletterFor(rec, base);
  const n = slotCount(rec);
  const stories = [];
  for (let i = 0; i < n; i++) {
    // Fewer fresh stories than slots: repeat from the top rather than leave holes.
    const a = nl.articles[i % nl.articles.length];
    stories.push({
      title: a.title,
      link: a.link,
      summary: a.summary || '',
      image: /^https:\/\//.test(a.image) ? a.image : `${base}/n/${rec.id}/noimage.png`,
      category: a.category || (i === 0 ? 'Top story' : 'Latest'),
    });
  }
  const opts = renderOpts(rec, base);
  return {
    updated: formatDate(nl.generatedAt, opts),
    updatedDate: formatDate(nl.generatedAt, { ...opts, withTime: false }),
    format: formatId(format),
    s: stories,
  };
}

/** The template rendered with mustache placeholders instead of stories. */
function skeleton(rec, base, format) {
  const nl = newsletterFor(rec, base);
  const n = slotCount(rec);
  nl.generatedAt = SENTINEL_DATE;
  nl.articles = Array.from({ length: n }, (_, i) => ({
    ...Object.fromEntries(STORY_FIELDS.map((f) => [f, `{{s.${i}.${f}}}`])),
    description: `{{s.${i}.summary}}`,
    author: '',
    pubDate: '',
  }));
  const opts = renderOpts(rec, base);
  let html = templates.render(formatId(format), nl, opts);
  html = html.split(formatDate(SENTINEL_DATE, opts)).join('{{updated}}');
  html = html.split(formatDate(SENTINEL_DATE, { ...opts, withTime: false })).join('{{updatedDate}}');
  return html;
}

/* ---------------- HTML email -> AMP for Email ---------------- */

const AMP_HEAD = `<meta charset="utf-8">
<script async src="https://cdn.ampproject.org/v0.js"></script>
<script async custom-element="amp-list" src="https://cdn.ampproject.org/v0/amp-list-0.1.js"></script>
<script async custom-template="amp-mustache" src="https://cdn.ampproject.org/v0/amp-mustache-0.2.js"></script>
<style amp4email-boilerplate>body{visibility:hidden}</style>`;

// AMP email allows a fixed set of CSS; drop what the templates add for Outlook/Gmail quirks.
function cleanCss(css) {
  return css
    .replace(/\s*!important/g, '')
    .replace(/mso-[a-z-]+\s*:[^;"]*;?/gi, '')
    .replace(/-webkit-text-size-adjust\s*:[^;]*;?/gi, '');
}

function pxFromStyle(style, prop) {
  const m = (style || '').match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(\\d+)px`, 'i'));
  return m ? Number(m[1]) : 0;
}

/** Body markup of a template email, converted to AMP-valid markup. */
function toAmpBody(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  $('img').each((_, el) => {
    const img = $(el);
    const style = img.attr('style') || '';
    const width = Number(img.attr('width')) || pxFromStyle(style, 'width') || 300;
    const height = Number(img.attr('height')) || pxFromStyle(style, 'height') || Math.round(width * 0.56);
    const fixed = width <= 320 || /display:\s*inline-block/.test(style);
    const amp = $('<amp-img></amp-img>')
      .attr('src', img.attr('src'))
      .attr('alt', img.attr('alt') || '')
      .attr('width', String(width))
      .attr('height', String(height))
      .attr('layout', fixed ? 'fixed' : 'responsive');
    img.replaceWith(amp);
  });
  $('[style]').each((_, el) => {
    const s = cleanCss($(el).attr('style'));
    if (s.trim()) $(el).attr('style', s);
    else $(el).removeAttr('style');
  });
  // The 600px column shrinks to the screen in AMP (no !important media queries).
  $('table.wrap').attr('width', '100%').each((_, el) => {
    $(el).attr('style', `${$(el).attr('style') || ''};width:100%;max-width:600px`.replace(/^;/, '').replace(/(^|;)\s*width:600px;?/g, '$1'));
  });
  $('[data-ad-slot]').removeAttr('data-ad-slot');
  return { body: $('body').html(), css: cleanCss($('head style').html() || '') };
}

/** Full AMP email for a stored newsletter in one format. */
function renderAmpEmail(rec, base, format = rec.format) {
  const liveUrl = `${base}/n/${rec.id}/live.json?format=${formatId(format)}`;
  const live = toAmpBody(skeleton(rec, base, format));
  const fallback = toAmpBody(renderHtmlEmail(rec, base, format));
  return `<!doctype html>
<html ⚡4email data-css-strict>
<head>
${AMP_HEAD}
<style amp-custom>
${fallback.css.trim()}
</style>
</head>
<body>
<amp-list src="${liveUrl}" layout="container" items="." single-item>
<template type="amp-mustache">
${live.body.trim()}
</template>
<div fallback>
${fallback.body.trim()}
</div>
<div placeholder>
${fallback.body.trim()}
</div>
</amp-list>
</body>
</html>
`;
}

/* ---------------- Grey stand-in for stories without an image ---------------- */

let noImagePng;
function noImage() {
  if (noImagePng) return noImagePng;
  const w = 16;
  const h = 9;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0xe9)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  noImagePng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return noImagePng;
}

module.exports = { FORMATS, DEFAULT_FORMAT, formatId, newsletterFor, renderHtmlEmail, renderAmpEmail, liveData, adOptions, noImage, toAmpBody };
