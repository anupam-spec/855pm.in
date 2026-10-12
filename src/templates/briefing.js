'use strict';
/** "Briefing": serif headlines, top banner ad with "Why this ad?", ads every few stories (Live Mint markets / Sinar Harian style). */
const { esc, SANS, SERIF, shell, button, image, adSlot, footer, logo, formatDate } = require('./shared');

function item(a, nl) {
  return `<tr><td class="px" style="padding:24px 32px;border-bottom:1px solid #e3e3e3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top" style="padding-right:18px;">
<a href="${esc(a.link)}" target="_blank" style="font-family:${SERIF};font-size:21px;line-height:28px;color:#111111;text-decoration:none;">${esc(a.title)}</a>
${a.summary ? `<div style="font-family:${SANS};font-size:13px;line-height:19px;color:#6b6b6b;padding-top:10px;">${esc(a.summary)}</div>` : ''}
</td>
<td class="thumb" valign="top" width="150" style="width:150px;">${image(a, { width: 150, height: 100, nl })}</td>
</tr></table>
</td></tr>`;
}

function offer(ctx, accent) {
  const href = ctx.nl.publication.url || ctx.browserUrl;
  return `<tr><td class="px" style="padding:20px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" style="background:#fdf1e4;border:1px solid #f4d9bd;border-radius:6px;padding:18px 16px;font-family:${SANS};">
<div style="font-size:13px;color:#555555;padding-bottom:12px;">Click here to see the latest updates and exclusive offers.</div>
${button(href, 'Click here', { bg: accent, radius: 4, size: 13, padding: '9px 22px' })}
</td></tr></table></td></tr>`;
}

function render(ctx) {
  const { nl } = ctx;
  const accent = ctx.accent || '#d80f1c';
  const rows = [];
  let mid = 0;
  nl.articles.forEach((a, i) => {
    rows.push(item(a, nl));
    if (i < nl.articles.length - 1 && i % 3 === 2) rows.push((i / 3) % 2 < 1 ? adSlot(ctx, 'mid', ++mid) : offer(ctx, accent));
  });

  const body = `<tr><td align="center" style="padding:20px 32px 10px;">${logo(ctx, { font: SERIF })}</td></tr>
<tr><td align="center" style="padding:0 32px 10px;font-family:${SANS};font-size:12px;color:#666666;">Last Updated : <b>${esc(formatDate(nl.generatedAt, ctx.opts))}</b></td></tr>
<tr><td align="center" style="background:#eceff1;padding:8px 16px;font-family:${SANS};font-size:12px;color:#222222;">The news updates periodically. Come back in an hour for new stories.</td></tr>
${adSlot(ctx, 'top')}
<tr><td align="center" style="padding:0 0 6px;font-family:${SANS};font-size:11px;"><a href="https://support.google.com/admanager/answer/7029010" target="_blank" style="color:#1a73e8;">Why this ad?</a></td></tr>
${rows.join('\n')}
${adSlot(ctx, 'bottom')}
${footer(ctx, { bg: '#f5f5f5', color: '#666666', link: '#222222' })}`;
  return shell({ nl, body, bg: '#ffffff', font: SERIF });
}

module.exports = {
  id: 'briefing',
  name: 'Briefing',
  description: 'Serif headline list with a top banner ad and ads or offer boxes after every third story.',
  render,
};
