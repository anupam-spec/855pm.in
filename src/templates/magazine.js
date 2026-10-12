'use strict';
/** "Magazine": dark hero story of the day, thumbnail cards and a featured band (India Today style). */
const { esc, SANS, shell, button, image, adSlot, footer, logo, updatedLine } = require('./shared');

const RED = '#e31e24';

function card(a, nl, accent) {
  return `<tr><td class="px" style="padding:24px 32px;border-bottom:1px solid #eeeeee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="stack" width="170" valign="top" style="width:170px;padding-right:20px;">${image(a, { width: 170, height: 120, nl })}</td>
<td class="stack" valign="top" style="font-family:${SANS};">
${a.category ? `<div style="font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${accent};padding:4px 0 6px;">${esc(a.category)}</div>` : ''}
<a href="${esc(a.link)}" target="_blank" style="font-size:19px;line-height:25px;font-weight:bold;color:#111111;text-decoration:none;">${esc(a.title)}</a>
${a.summary ? `<div style="font-size:14px;line-height:21px;color:#555555;padding-top:8px;">${esc(a.summary)}</div>` : ''}
${a.author ? `<div style="font-size:12px;font-style:italic;color:#888888;padding-top:8px;">By ${esc(a.author)}</div>` : ''}
<div style="padding-top:8px;"><a href="${esc(a.link)}" target="_blank" style="font-size:13px;font-weight:bold;color:${accent};text-decoration:none;">Read more &rarr;</a></div>
</td></tr></table>
</td></tr>`;
}

function render(ctx) {
  const { nl } = ctx;
  const accent = ctx.accent || RED;
  const [lead, ...rest] = nl.articles;
  const featured = rest.length >= 4 ? rest[2] : null;
  const cards = rest.filter((a) => a !== featured);

  const hero = `<tr><td class="px" style="background:#1c1c1c;padding:36px 40px;text-align:center;font-family:${SANS};">
<div style="font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${accent};padding-bottom:12px;">${esc(lead.category || 'Story of the day')}</div>
<a href="${esc(lead.link)}" target="_blank" style="font-size:28px;line-height:35px;font-weight:bold;color:#ffffff;text-decoration:none;">${esc(lead.title)}</a>
${lead.summary ? `<div style="font-size:15px;line-height:23px;color:#cfcfcf;padding-top:14px;">${esc(lead.summary)}</div>` : ''}
<div style="width:60px;height:3px;background:${accent};margin:20px auto;line-height:3px;font-size:0;">&nbsp;</div>
${lead.image ? `<div style="padding-bottom:16px;">${image(lead, { width: 520, nl })}</div>` : ''}
${lead.author ? `<div style="font-size:13px;font-style:italic;color:#a8a8a8;padding-bottom:18px;">By ${esc(lead.author)}</div>` : ''}
${button(lead.link, 'READ THE FULL STORY', { bg: accent })}
</td></tr>`;

  const feature = featured
    ? `<tr><td class="px" style="background:#fff3f3;border-top:2px solid ${accent};padding:32px 40px;text-align:center;font-family:${SANS};">
<div style="padding-bottom:12px;"><span style="background:${accent};color:#ffffff;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;padding:4px 10px;">${esc(featured.category || 'Featured')}</span></div>
<a href="${esc(featured.link)}" target="_blank" style="font-size:24px;line-height:31px;color:#111111;text-decoration:none;">${esc(featured.title)}</a>
${featured.image ? `<div style="padding-top:16px;">${image(featured, { width: 520, nl })}</div>` : ''}
${featured.summary ? `<div style="font-size:14px;line-height:22px;color:#444444;padding-top:14px;">${esc(featured.summary)}</div>` : ''}
${featured.author ? `<div style="font-size:12px;font-style:italic;color:#888888;padding:6px 0 0;">By ${esc(featured.author)}</div>` : ''}
<div style="padding-top:18px;">${button(featured.link, 'READ FULL STORY →', { bg: '#111111' })}</div>
</td></tr>`
    : '';

  const top = cards.slice(0, 2).map((a) => card(a, nl, accent)).join('');
  const bottom = cards.slice(2);
  const half = Math.ceil(bottom.length / 2);

  const body = `<tr><td style="height:6px;background:${accent};line-height:6px;font-size:0;">&nbsp;</td></tr>
<tr><td align="center" style="padding:22px 32px 10px;">${logo(ctx)}</td></tr>
${updatedLine(ctx)}
${nl.intro ? `<tr><td class="px" style="padding:0 40px 18px;text-align:center;font-family:${SANS};font-size:14px;color:#555555;">${esc(nl.intro)}</td></tr>` : ''}
${hero}
${adSlot(ctx, 'mid', 1)}
${top}
${feature}
${bottom.slice(0, half).map((a) => card(a, nl, accent)).join('')}
${bottom.length > 2 ? adSlot(ctx, 'mid', 2) : ''}
${bottom.slice(half).map((a) => card(a, nl, accent)).join('')}
${adSlot(ctx, 'bottom')}
${footer(ctx)}`;
  return shell({ nl, body, bg: '#f4f4f4' });
}

module.exports = {
  id: 'magazine',
  name: 'Magazine',
  description: 'Dark "story of the day" hero, thumbnail cards with section labels and a highlighted feature.',
  render,
};
