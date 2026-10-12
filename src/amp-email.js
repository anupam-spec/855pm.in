'use strict';
/**
 * The publisher newsletter as an email: an AMP part whose story list is
 * fetched live from our server every time the email is opened, plus static
 * HTML and plain-text parts for clients without AMP (and for Gmail until the
 * sender is registered with Google).
 *
 * Masthead: the publisher's logo, and below it the time the stories were last
 * built. In the AMP part that line comes from the live endpoint, so it moves
 * forward whenever the reader re-opens the email.
 */
const { escapeHtml: esc, truncate } = require('./util');

const STORY_COUNT = 8;
const TIME_ZONE = process.env.NEWSLETTER_TZ || 'Asia/Kolkata';

/** "12 Oct 2026, 2:50 PM IST" */
function formatStamp(date, timeZone = TIME_ZONE) {
  const d = new Date(date);
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const tz = get('timeZoneName') === 'GMT+5:30' ? 'IST' : get('timeZoneName');
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()} ${tz}`;
}

function shortDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}

/** Articles -> the JSON shape the AMP template and HTML part both render. */
function storyItems(articles, count = STORY_COUNT) {
  return articles
    .filter((a) => a.title && a.link)
    .slice(0, count)
    .map((a) => ({
      title: a.title,
      link: a.link,
      summary: truncate(a.description || '', 180),
      image: /^https:\/\//i.test(a.image || '') ? a.image : '',
      category: a.category || '',
      date: shortDate(a.pubDate),
    }));
}

/**
 * Body of the live endpoint, read by `<amp-list items="." single-item>`:
 * the masthead stamp, the lead story and the rest.
 */
function liveJson({ articles, builtAt }) {
  const stories = storyItems(articles);
  return { updated: formatStamp(builtAt), builtAt: new Date(builtAt).toISOString(), stories, lead: stories.slice(0, 1), more: stories.slice(1) };
}

const COLORS = { ink: '#16181d', muted: '#5f6673', rule: '#e4e6eb', bg: '#f3f4f6', card: '#ffffff' };

const CSS = `
body{margin:0;padding:0;background:${COLORS.bg};font-family:Georgia,'Times New Roman',serif;color:${COLORS.ink}}
.wrap{max-width:600px;margin:0 auto;background:${COLORS.card}}
.mast{padding:28px 24px 18px;text-align:center;border-bottom:3px solid ACCENT}
.logo{display:block;margin:0 auto}
.pubname{font-size:30px;font-weight:bold;letter-spacing:.5px;margin:0}
.stamp{margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${COLORS.muted};letter-spacing:.3px}
.stories{padding:8px 24px 16px}
.story{padding:18px 0;border-bottom:1px solid ${COLORS.rule}}
.story:last-child{border-bottom:0}
.lead .thumb{width:100%;height:auto;margin-bottom:12px}
.kicker{font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.8px;color:ACCENT;margin:0 0 6px}
.title{font-size:20px;line-height:1.3;margin:0 0 6px}
.lead .title{font-size:26px}
.title a{color:${COLORS.ink};text-decoration:none}
.summary{font-size:15px;line-height:1.5;color:#333a45;margin:0}
.meta{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${COLORS.muted};margin:8px 0 0}
.row{display:flex;gap:14px}
.row .text{flex:1}
.row .side{width:120px;flex:none}
.foot{padding:20px 24px;background:${COLORS.bg};font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${COLORS.muted};text-align:center;line-height:1.6}
.foot a{color:${COLORS.muted}}
.live{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:8px;background:#e8f5ec;color:#1e7b3c;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.5px}
`;

function css(accent) {
  return CSS.replace(/ACCENT/g, /^#[0-9a-f]{3,8}$/i.test(accent || '') ? accent : '#c8102e').trim();
}

function mastheadLogo(pub, amp) {
  if (!pub.logoUrl) return `<p class="pubname">${esc(pub.name)}</p>`;
  const w = pub.logoWidth || 220;
  const h = pub.logoHeight || 60;
  return amp
    ? `<a href="${esc(pub.url)}"><amp-img class="logo" src="${esc(pub.logoUrl)}" alt="${esc(pub.name)}" width="${w}" height="${h}" layout="fixed"></amp-img></a>`
    : `<a href="${esc(pub.url)}"><img class="logo" src="${esc(pub.logoUrl)}" alt="${esc(pub.name)}" width="${w}" height="${h}" style="display:block;margin:0 auto;max-width:100%;height:auto"></a>`;
}

function footer(pub) {
  return `<div class="foot">You are receiving this because you signed up for ${esc(pub.name)} updates.<br><a href="${esc(pub.url)}">${esc(pub.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></div>`;
}

/**
 * AMP for Email part. `liveUrl` must be https and answer with liveJson();
 * `fallback` is the data baked in at send time, shown if the fetch fails.
 */
function renderAmp({ publication: pub, liveUrl, fallback }) {
  const story = (lead) => `
        <div class="story${lead ? ' lead' : ''}">
          ${lead ? '{{#image}}<a href="{{link}}"><amp-img class="thumb" src="{{image}}" alt="" width="552" height="310" layout="responsive"></amp-img></a>{{/image}}' : ''}
          ${lead ? '' : '<div class="row"><div class="text">'}
          {{#category}}<p class="kicker">{{category}}</p>{{/category}}
          <h2 class="title"><a href="{{link}}">{{title}}</a></h2>
          {{#summary}}<p class="summary">{{summary}}</p>{{/summary}}
          {{#date}}<p class="meta">{{date}}</p>{{/date}}
          ${lead ? '' : '</div>{{#image}}<div class="side"><a href="{{link}}"><amp-img src="{{image}}" alt="" width="120" height="80" layout="fixed"></amp-img></a></div>{{/image}}</div>'}
        </div>`;
  const fb = fallback;
  const staticStories = fb.stories.map((s, i) => staticStory(s, i === 0, true)).join('');
  return `<!doctype html>
<html ⚡4email data-css-strict>
<head>
  <meta charset="utf-8">
  <script async src="https://cdn.ampproject.org/v0.js"></script>
  <script async custom-element="amp-list" src="https://cdn.ampproject.org/v0/amp-list-0.1.js"></script>
  <script async custom-template="amp-mustache" src="https://cdn.ampproject.org/v0/amp-mustache-0.2.js"></script>
  <style amp4email-boilerplate>body{visibility:hidden}</style>
  <style amp-custom>
${css(pub.accent)}
  </style>
</head>
<body>
  <div class="wrap">
    <amp-list src="${esc(liveUrl)}" layout="container" items="." single-item>
      <template type="amp-mustache">
        <div class="mast">
          ${mastheadLogo(pub, true)}
          <p class="stamp">Updated {{updated}} <span class="live">Live</span></p>
        </div>
        <div class="stories">
          {{#lead}}${story(true)}{{/lead}}
          {{#more}}${story(false)}{{/more}}
        </div>
      </template>
      <div fallback>
        <div class="mast">
          ${mastheadLogo(pub, true)}
          <p class="stamp">Updated ${esc(fb.updated)}</p>
        </div>
        <div class="stories">${staticStories}
        </div>
      </div>
      <div placeholder>
        <div class="mast">
          ${mastheadLogo(pub, true)}
          <p class="stamp">Updated ${esc(fb.updated)}</p>
        </div>
        <div class="stories">${staticStories}
        </div>
      </div>
    </amp-list>
    ${footer(pub)}
  </div>
</body>
</html>
`;
}

function staticStory(s, lead, amp) {
  const img = (w, h, cls) =>
    amp
      ? `<amp-img${cls ? ` class="${cls}"` : ''} src="${esc(s.image)}" alt="" width="${w}" height="${h}" layout="${cls ? 'responsive' : 'fixed'}"></amp-img>`
      : `<img${cls ? ` class="${cls}"` : ''} src="${esc(s.image)}" alt="" width="${w}"${cls ? ' style="width:100%;height:auto"' : ` height="${h}" style="object-fit:cover"`}>`;
  const text = `
            ${s.category ? `<p class="kicker">${esc(s.category)}</p>` : ''}
            <h2 class="title"><a href="${esc(s.link)}">${esc(s.title)}</a></h2>
            ${s.summary ? `<p class="summary">${esc(s.summary)}</p>` : ''}
            ${s.date ? `<p class="meta">${esc(s.date)}</p>` : ''}`;
  if (lead) {
    return `
          <div class="story lead">
            ${s.image ? `<a href="${esc(s.link)}">${img(552, 310, 'thumb')}</a>` : ''}${text}
          </div>`;
  }
  return `
          <div class="story"><div class="row"><div class="text">${text}
            </div>${s.image ? `<div class="side"><a href="${esc(s.link)}">${img(120, 80)}</a></div>` : ''}</div>
          </div>`;
}

/** Static HTML part (also what the publisher previews in the browser). */
function renderHtml({ publication: pub, data }) {
  const d = data;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(pub.name)}</title>
  <style>
${css(pub.accent)}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="mast">
      ${mastheadLogo(pub, false)}
      <p class="stamp">Updated ${esc(d.updated)}</p>
    </div>
    <div class="stories">${d.stories.map((s, i) => staticStory(s, i === 0, false)).join('')}
    </div>
    ${footer(pub)}
  </div>
</body>
</html>
`;
}

function renderText({ publication: pub, data }) {
  const d = data;
  const lines = [pub.name.toUpperCase(), `Updated ${d.updated}`, ''];
  for (const s of d.stories) lines.push(s.title, s.link, '');
  lines.push(pub.url);
  return lines.join('\n');
}

module.exports = { renderAmp, renderHtml, renderText, liveJson, storyItems, formatStamp };
