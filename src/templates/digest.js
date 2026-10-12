'use strict';
/** "Digest": text-first numbered briefing that stays small enough to avoid Gmail's 102KB clipping. */
const { esc, SANS, shell, image, adSlot, footer, logo, formatDate } = require('./shared');

function render(ctx) {
  const { nl } = ctx;
  const accent = ctx.accent || '#2457d6';
  const [lead, ...rest] = nl.articles;
  const top = rest.slice(0, 5);
  const quick = rest.slice(5);

  const numbered = top
    .map(
      (a, i) => `<tr><td class="px" style="padding:16px 32px;border-bottom:1px solid #eef0f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top" width="40" style="width:40px;font-family:${SANS};font-size:26px;font-weight:bold;color:${accent};line-height:26px;">${i + 2}</td>
<td valign="top" style="font-family:${SANS};">
${a.category ? `<div style="font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#8a8f98;padding-bottom:4px;">${esc(a.category)}</div>` : ''}
<a href="${esc(a.link)}" target="_blank" style="font-size:17px;line-height:23px;font-weight:bold;color:#14171f;text-decoration:none;">${esc(a.title)}</a>
${a.summary ? `<div style="font-size:14px;line-height:21px;color:#4a505c;padding-top:6px;">${esc(a.summary)}</div>` : ''}
</td></tr></table>
</td></tr>`
    )
    .join('');

  const quickList = quick.length
    ? `<tr><td class="px" style="padding:24px 32px 8px;font-family:${SANS};font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#14171f;">Quick reads</td></tr>
<tr><td class="px" style="padding:0 32px 16px;font-family:${SANS};">
${quick.map((a) => `<div style="padding:8px 0;border-bottom:1px dotted #d5d9e0;font-size:14px;line-height:20px;">&#9656; <a href="${esc(a.link)}" target="_blank" style="color:#14171f;text-decoration:none;">${esc(a.title)}</a></div>`).join('\n')}
</td></tr>`
    : '';

  const body = `<tr><td class="px" style="padding:24px 32px 8px;border-bottom:3px solid ${accent};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" align="center">${logo(ctx, { height: 32, size: 22 })}</td>
</tr><tr><td align="center" style="padding-top:8px;font-family:${SANS};font-size:12px;color:#8a8f98;">Updated ${esc(formatDate(nl.generatedAt, ctx.opts))}</td></tr></table></td></tr>
<tr><td class="px" style="padding:22px 32px 6px;font-family:${SANS};font-size:15px;line-height:22px;color:#4a505c;">${esc(nl.intro || `Here are today's top ${nl.articles.length} stories from ${nl.publication.name}.`)}</td></tr>
<tr><td class="px" style="padding:16px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f7ff;border-left:4px solid ${accent};"><tr><td style="padding:18px 20px;font-family:${SANS};">
<div style="font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${accent};padding-bottom:6px;">1 &middot; Top story</div>
<a href="${esc(lead.link)}" target="_blank" style="font-size:21px;line-height:28px;font-weight:bold;color:#14171f;text-decoration:none;">${esc(lead.title)}</a>
${lead.image ? `<div style="padding-top:12px;">${image(lead, { width: 492, nl })}</div>` : ''}
${lead.summary ? `<div style="font-size:14px;line-height:21px;color:#4a505c;padding-top:10px;">${esc(lead.summary)}</div>` : ''}
<div style="padding-top:10px;"><a href="${esc(lead.link)}" target="_blank" style="font-size:13px;font-weight:bold;color:${accent};text-decoration:none;">Read the story &rarr;</a></div>
</td></tr></table>
</td></tr>
${numbered}
${adSlot(ctx, 'mid', 1)}
${quickList}
${adSlot(ctx, 'bottom')}
${footer(ctx, { bg: '#f4f5f7', color: '#6b7280', link: '#14171f' })}`;
  return shell({ nl, body, bg: '#eceef2' });
}

module.exports = {
  id: 'digest',
  name: 'Digest',
  description: 'Lightweight numbered briefing: top story, five numbered picks and a quick-reads list.',
  render,
};
