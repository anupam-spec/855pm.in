'use strict';
/**
 * "Your newsletter": the publisher's existing newsletter (the web version of
 * an issue they already send) used as the design. We keep its look and swap
 * its stories for the latest ones from their site: each story's links,
 * headline, picture and summary are replaced in place, in order.
 *
 * Stories are recognised as links with headline-length text; links to the
 * same article (picture + headline) count as one story. Social, unsubscribe
 * and "view in browser" links are left alone.
 */
const cheerio = require('cheerio');
const { absolutize } = require('./util');
const { esc, SANS } = require('./templates/shared');

const MAX_STORIES = 12;
const SKIP_LINK = /^(mailto:|tel:|#|javascript:)|facebook\.com|twitter\.com|\/\/x\.com|instagram\.com|linkedin\.com|youtube\.com|youtu\.be|whatsapp|t\.me\/|telegram|pinterest|list-manage\.com|unsubscribe|optout|opt-out|preferences|view.?in.?browser|webversion|apps\.apple\.com|play\.google\.com/i;
const SKIP_TEXT = /skip to|do not sell|cookie|sign in|log ?in|sign up|subscribe|read online|unsubscribe|view (it )?in (your )?browser|web version|update (your )?preferences|privacy policy|terms of (use|service)|contact us|download (the|our) app|follow us|forward to a friend|manage (your )?subscription/i;

/** Remove anything that can't go in an email and make URLs absolute. */
function sanitize(html, baseUrl) {
  const $ = cheerio.load(html);
  $('script, noscript, iframe, object, embed, form, input, button, select, textarea, link[rel=preload], link[rel=stylesheet], meta[http-equiv=refresh], base').remove();
  $('*').each((_, el) => {
    for (const name of Object.keys(el.attribs || {})) if (/^on/i.test(name)) $(el).removeAttr(name);
  });
  $('a[href]').each((_, el) => $(el).attr('href', absolutize($(el).attr('href'), baseUrl) || $(el).attr('href')));
  $('img').each((_, el) => {
    const img = $(el);
    const src = img.attr('src') || img.attr('data-src') || '';
    img.attr('src', absolutize(src, baseUrl) || src);
    img.removeAttr('srcset').removeAttr('data-src').removeAttr('loading');
  });
  return $.html();
}

const textOf = ($, el) => $(el).text().replace(/\s+/g, ' ').trim();

/** Story slots in document order: {href, anchors[], titleAnchor, images[], summary}. */
function findStories($) {
  const byHref = new Map();
  $('body a[href]').each((_, el) => {
    if ($(el).closest('nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo]').length) return;
    const href = ($(el).attr('href') || '').trim();
    if (!/^https?:\/\//i.test(href) || SKIP_LINK.test(href)) return;
    try {
      if (new URL(href).pathname.replace(/\/+$/, '') === '') return; // homepage link (logo)
    } catch {
      return;
    }
    const key = href.replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (!byHref.has(key)) byHref.set(key, { anchors: [] });
    byHref.get(key).anchors.push(el);
  });

  const stories = [];
  for (const group of byHref.values()) {
    const titled = group.anchors
      .map((a) => ({ a, text: textOf($, a) }))
      .filter(({ a, text }) => text.length >= 20 && text.length <= 250 && !SKIP_TEXT.test(text) && $(a).find('img').length === 0);
    if (!titled.length) continue;
    const titleAnchor = titled.sort((x, y) => y.text.length - x.text.length)[0].a;
    const images = group.anchors.flatMap((a) => $(a).find('img').toArray());
    stories.push({ anchors: group.anchors, titleAnchor, images, summary: findSummary($, titleAnchor) });
    if (stories.length >= MAX_STORIES) break;
  }
  return stories;
}

/** The paragraph right after a headline, when it is plain text. */
function findSummary($, titleAnchor) {
  const block = $(titleAnchor).closest('h1,h2,h3,h4,h5,h6,p,div,td,span,strong,b');
  const start = block.length ? block : $(titleAnchor);
  const next = start.nextAll('p,div,span,td').filter((_, el) => {
    const t = textOf($, el);
    return t.length >= 40 && $(el).find('a,img,table').length === 0;
  }).first();
  return next.length ? next.get(0) : null;
}

/**
 * Fetch result -> what we store: cleaned HTML and how many stories it has.
 * Throws when no stories can be recognised.
 */
function importNewsletter(html, url) {
  const clean = sanitize(html, url);
  const $ = cheerio.load(clean);
  const count = findStories($).length;
  if (!count) {
    const err = new Error("We couldn't find any stories in that newsletter. Use the link to the web version of one issue (the \"View in browser\" link).");
    err.status = 422;
    throw err;
  }
  return { html: clean, url, stories: count, title: textOf($, $('title').first()) };
}

function updatedBar(updated, accent) {
  return `<div style="font-family:${SANS};font-size:12px;color:#555555;text-align:center;padding:8px 12px;border-bottom:2px solid ${accent};">Updated ${updated}</div>`;
}

/**
 * The stored newsletter with stories replaced. `stories[i]` has title, link,
 * summary, image (strings, already escaped-safe for attributes when they are
 * mustache placeholders). `updated` and `adHtml` go at the top.
 */
function render(stored, { stories, updated, adHtml = '', accent = '#c8102e' }) {
  const $ = cheerio.load(stored.html);
  findStories($).forEach((slot, i) => {
    const s = stories[i % stories.length];
    for (const a of slot.anchors) $(a).attr('href', s.link);
    $(slot.titleAnchor).text(s.title);
    for (const img of slot.images) {
      if (s.image) $(img).attr('src', s.image).attr('alt', s.title);
    }
    if (slot.summary) $(slot.summary).text(s.summary || '');
  });
  $('body').prepend(`${updatedBar(esc(updated), accent)}${adHtml}`);
  return $.html();
}

module.exports = { importNewsletter, render, findStories, sanitize };
