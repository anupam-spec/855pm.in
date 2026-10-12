'use strict';
/** "Newsfeed": dated header, update banner, headline + snippet with image on the right (Times of India style). */
const { esc, SANS, shell, button, image, adSlot, footer, logo, formatDate } = require('./shared');

const RED = '#e21b22';

function item(a, nl) {
  return `<tr><td class="px" style="padding:22px 32px;border-bottom:1px solid #e6e6e6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top" style="font-family:${SANS};padding-right:16px;">
<a href="${esc(a.link)}" target="_blank" style="font-size:19px;line-height:26px;color:#111111;text-decoration:none;">${esc(a.title)}</a>
${a.summary ? `<div style="font-size:13px;line-height:19px;color:#767676;padding-top:10px;">${esc(a.summary)}</div>` : ''}
</td>
<td class="thumb" valign="top" width="180" style="width:180px;">${image(a, { width: 180, height: 110, nl, radius: 4 })}</td>
</tr></table>
</td></tr>`;
}

function cta(ctx, accent) {
  const href = ctx.nl.publication.url || ctx.browserUrl;
  return `<tr><td class="px" style="padding:22px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" style="background:#f3f3f3;border:1px solid #e2e2e2;border-radius:8px;padding:22px 16px;font-family:${SANS};">
<div style="font-size:14px;color:#333333;padding-bottom:14px;">To see the latest updates and exclusive offers click here</div>
${button(href, 'Click Here', { bg: accent, radius: 6, size: 13, padding: '10px 26px' })}
</td></tr></table></td></tr>`;
}

function render(ctx) {
  const { nl } = ctx;
  const accent = ctx.accent || RED;
  const updated = formatDate(nl.generatedAt, ctx.opts);
  const rows = [];
  nl.articles.forEach((a, i) => {
    rows.push(item(a, nl));
    if (i % 6 === 2 && i < nl.articles.length - 1) rows.push(cta(ctx, accent));
    else if (i % 6 === 5 && i < nl.articles.length - 1) rows.push(adSlot(ctx, 'mid', Math.ceil(i / 6)));
  });

  const body = `<tr><td class="px" style="padding:14px 32px;font-family:${SANS};font-size:13px;color:#333333;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td></td>
<td align="right"><a href="${esc(ctx.browserUrl)}" target="_blank" style="color:#333333;text-decoration:underline;">View in Browser</a></td>
</tr></table></td></tr>
<tr><td align="center" style="padding:20px 32px 8px;">${logo(ctx, { size: 30 })}</td></tr>
<tr><td align="center" style="padding:0 32px 14px;font-family:${SANS};font-size:12px;color:#666666;">Last Updated : ${esc(updated)}</td></tr>
${adSlot(ctx, 'top')}
<tr><td class="px" style="padding:4px 32px 0;"><div style="background:${accent};border-radius:4px;padding:10px 14px;font-family:${SANS};font-size:13px;color:#ffffff;">&bull; The news updates periodically. Come back in an hour for new stories.</div></td></tr>
${rows.join('\n')}
${adSlot(ctx, 'bottom')}
${footer(ctx)}`;
  return shell({ nl, body, bg: '#ffffff' });
}

module.exports = {
  id: 'newsfeed',
  name: 'Newsfeed',
  description: 'Live-updating news list: headline and snippet with a thumbnail on the right, CTA boxes and ads between stories.',
  render,
};
