'use strict';
/** "Tiles": lead story, two-up tiles, text sections and a picture grid (Mint Money style). */
const { esc, SANS, SERIF, shell, button, readMore, image, adSlot, footer, logo, formatDate } = require('./shared');

const ORANGE = '#f99d1c';

function section(title, accent) {
  return `<tr><td class="px" style="padding:24px 32px 4px;"><div style="border-top:2px solid ${accent};padding-top:10px;font-family:${SERIF};font-size:14px;font-weight:bold;color:#111111;">${esc(title)}</div></td></tr>`;
}

const readMoreSmall = (a, accent) => readMore(a.link, accent, { size: 12, padding: '7px 14px' });

function tile(a, accent) {
  return `<a href="${esc(a.link)}" target="_blank" style="font-family:${SERIF};font-size:15px;line-height:21px;font-weight:bold;color:#111111;text-decoration:none;">${esc(a.title)}</a>${readMoreSmall(a, accent)}`;
}

function textItem(a, accent) {
  return `<tr><td class="px" style="padding:14px 32px;border-bottom:1px solid #efefef;">${tile(a, accent)}</td></tr>`;
}

function render(ctx) {
  const { nl } = ctx;
  const accent = ctx.accent || ORANGE;
  const arts = nl.articles;
  const lead = arts[0];
  const pair = arts.slice(1, 3);
  const grid = arts.length >= 9 ? arts.slice(-3) : [];
  const middle = arts.slice(3, arts.length - grid.length);
  const more = middle.slice(0, Math.ceil(middle.length / 2));
  const also = middle.slice(more.length);
  const sectionName = lead.category || nl.publication.name;

  const leadRow = `${section(sectionName, accent)}
<tr><td class="px" style="padding:12px 32px 4px;">
${lead.image ? `<div style="padding-bottom:14px;">${image(lead, { width: 536, nl })}</div>` : ''}
<a href="${esc(lead.link)}" target="_blank" style="font-family:${SERIF};font-size:24px;line-height:31px;font-weight:bold;color:#111111;text-decoration:none;">${esc(lead.title)}</a>
${lead.summary ? `<div style="font-family:${SANS};font-size:14px;line-height:21px;color:#555555;padding-top:8px;">${esc(lead.summary)}</div>` : ''}
${readMore(lead.link, accent, { size: 14, padding: '11px 22px' })}
</td></tr>`;

  const pairRow = pair.length
    ? `<tr><td class="px" style="padding:20px 32px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${pair.map((a, i) => `<td class="stack" valign="top" width="50%" style="width:50%;${i ? 'padding-left:12px;' : 'padding-right:12px;'}padding-bottom:12px;">${tile(a, accent)}</td>`).join('')}
</tr></table></td></tr>`
    : '';

  const gridRow = grid.length
    ? `${section('Recommended for you', accent)}
<tr><td class="px" style="padding:12px 32px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
${grid.map((a, i) => `<td class="stack" valign="top" width="33%" style="width:33%;padding:0 ${i < 2 ? 8 : 0}px 12px ${i ? 8 : 0}px;">${image(a, { width: 168, height: 100, nl })}<div style="padding-top:8px;"><a href="${esc(a.link)}" target="_blank" style="font-family:${SANS};font-size:13px;line-height:18px;color:#111111;text-decoration:none;">${esc(a.title)}</a></div></td>`).join('')}
</tr></table></td></tr>`
    : '';

  const body = `<tr><td align="center" style="padding:22px 32px 6px;">${logo(ctx, { font: SERIF })}</td></tr>
<tr><td align="center" style="padding:0 32px 8px;font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:1px;color:#444444;text-transform:uppercase;">${esc(formatDate(nl.generatedAt, ctx.opts))}</td></tr>
<tr><td align="center" style="padding:0 32px 14px;"><span style="display:inline-block;border:1px solid ${accent};background:#fff8ec;border-radius:3px;padding:3px 10px;font-family:${SANS};font-size:10px;font-weight:bold;letter-spacing:1px;color:#8a5a00;text-transform:uppercase;">&bull; Updates through the day</span></td></tr>
${adSlot(ctx, 'top')}
${leadRow}
${pairRow}
${adSlot(ctx, 'mid', 1)}
${more.length ? section('Top stories', accent) + more.map((a) => textItem(a, accent)).join('') : ''}
${also.length ? adSlot(ctx, 'mid', 2) + section(`More from ${nl.publication.name}`, accent) + also.map((a) => textItem(a, accent)).join('') : ''}
${nl.publication.url ? `<tr><td class="px" style="padding:24px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:${accent};border-radius:3px;"><a href="${esc(nl.publication.url)}" target="_blank" style="display:block;padding:12px;font-family:${SANS};font-size:13px;font-weight:bold;color:#111111;text-decoration:none;">See all ${esc(nl.publication.name)} stories</a></td></tr></table></td></tr>` : ''}
${gridRow}
${adSlot(ctx, 'bottom')}
<tr><td style="padding:0 32px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${footer(ctx, { bg: '#141414' })}</table>
</td></tr>`;
  return shell({ nl, body, bg: '#f6f6f6' });
}

module.exports = {
  id: 'tiles',
  name: 'Tiles',
  description: 'Lead story with button, two-up tiles, sectioned text lists, "see all" button and a recommended picture grid.',
  render,
};
