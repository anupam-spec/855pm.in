'use strict';
/**
 * Building blocks shared by every newsletter template: escaping, the email
 * document shell, buttons, images and Google Ad Manager ad slots.
 *
 * Templates are table-based with inline styles so they survive Gmail,
 * Outlook and Apple Mail.
 */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const SANS = "Arial, Helvetica, sans-serif";
const SERIF = "Georgia, 'Times New Roman', Times, serif";

function formatDate(iso, { timeZone = 'Asia/Kolkata', locale = 'en-IN', withTime = true } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const opts = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit', hour12: true, timeZoneName: 'short' });
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

/** Full HTML email document with hidden preheader and a centred 600px column. */
function shell({ nl, body, bg = '#f2f2f2', font = SANS, width = 600 }) {
  const lang = esc(nl.publication.language || 'en');
  return `<!DOCTYPE html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(nl.subject)}</title>
<style>
  body{margin:0;padding:0;-webkit-text-size-adjust:100%;}
  img{border:0;outline:none;text-decoration:none;display:block;max-width:100%;height:auto;}
  a{text-decoration:none;}
  @media only screen and (max-width:620px){
    .wrap{width:100% !important;}
    .stack{display:block !important;width:100% !important;padding-left:0 !important;padding-right:0 !important;}
    .stack img{width:100% !important;max-width:100% !important;height:auto !important;}
    .stack + .stack{padding-top:12px !important;}
    .thumb{width:110px !important;}
    .thumb img{max-width:110px !important;height:auto !important;}
    .hide-sm{display:none !important;}
    .px{padding-left:16px !important;padding-right:16px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${bg};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${bg};">${esc(nl.preheader)}&#8203;&zwnj;&nbsp;&#8203;&zwnj;&nbsp;&#8203;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};">
<tr><td align="center" style="padding:16px 8px;">
<table role="presentation" class="wrap" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:${width}px;max-width:${width}px;background:#ffffff;font-family:${font};">
${body}
</table>
</td></tr>
</table>
</body>
</html>
`;
}

function button(href, label, { bg = '#e31e24', color = '#ffffff', radius = 4, font = SANS, size = 14, padding = '12px 24px' } = {}) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td style="background:${bg};border-radius:${radius}px;">
<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:${padding};font-family:${font};font-size:${size}px;font-weight:bold;color:${color};text-decoration:none;border-radius:${radius}px;">${esc(label)}</a>
</td></tr></table>`;
}

/** Article image, or a neutral block with the publication initial when the article has none. */
function image(a, { width, height, nl, radius = 0, alt } = {}) {
  const h = height ? `height:${height}px;` : '';
  if (a.image) {
    return `<a href="${esc(a.link)}" target="_blank"><img src="${esc(a.image)}" width="${width}" alt="${esc(alt ?? a.title)}" style="display:block;width:100%;max-width:${width}px;${h}object-fit:cover;border-radius:${radius}px;background:#e9e9e9;"></a>`;
  }
  const initial = esc((nl?.publication.name || '?').trim().charAt(0).toUpperCase());
  return `<a href="${esc(a.link)}" target="_blank" style="text-decoration:none;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" height="${height || Math.round(width * 0.56)}" style="background:#ececec;border-radius:${radius}px;font-family:${SANS};font-size:28px;font-weight:bold;color:#b5b5b5;">${initial}</td></tr></table></a>`;
}

function byline(a, { color = '#777777', font = SANS, size = 12, italic = false } = {}) {
  if (!a.author) return '';
  return `<div style="font-family:${font};font-size:${size}px;color:${color};${italic ? 'font-style:italic;' : ''}padding-top:6px;">By ${esc(a.author)}</div>`;
}

/* ---------------- Google Ad Manager ad slots ---------------- */

/**
 * Ad options (opts.ads):
 *   mode:        'placeholder' (default) draws a labelled dummy creative so the
 *                preview always shows where ads go; 'gam' emits the real
 *                email-safe GAM image tag (gampad/ad inside gampad/jump).
 *                'none' removes ads.
 *   networkCode: GAM network code. Defaults to Google's public sample network 6499.
 *   adUnitPrefix: ad unit path under the network. Defaults to "example/newsletter".
 *   sizes:       override slot sizes, e.g. {top:'320x50', mid:'300x250', bottom:'300x250'}.
 */
const DEFAULT_ADS = { mode: 'placeholder', networkCode: '6499', adUnitPrefix: 'example/newsletter', sizes: {} };
const DEFAULT_SIZES = { top: '320x50', mid: '300x250', bottom: '300x250', leaderboard: '600x90' };

function adConfig(opts = {}) {
  return { ...DEFAULT_ADS, ...(opts.ads || {}), sizes: { ...DEFAULT_SIZES, ...(opts.ads?.sizes || {}) } };
}

function gamUrls(cfg, slotName, size, templateId, cacheBuster) {
  const iu = `/${cfg.networkCode}/${cfg.adUnitPrefix}/${templateId}_${slotName}`.replace(/\/+/g, '/');
  const q = `iu=${encodeURIComponent(iu)}&sz=${size}&c=${cacheBuster}`;
  return {
    iu,
    img: `https://securepubads.g.doubleclick.net/gampad/ad?${q}`,
    click: `https://securepubads.g.doubleclick.net/gampad/jump?${q}`,
  };
}

/**
 * One ad slot. `slot` is 'top' | 'mid' | 'bottom' | 'leaderboard'; `index`
 * distinguishes repeated mid slots (mid_1, mid_2 ...).
 */
function adSlot(ctx, slot, index = 0) {
  const cfg = adConfig(ctx.opts);
  if (cfg.mode === 'none') return '';
  const size = cfg.sizes[slot] || DEFAULT_SIZES.mid;
  const [w, h] = size.split('x').map(Number);
  const name = index ? `${slot}_${index}` : slot;
  const cacheBuster = `${ctx.cacheBuster}${index}`;
  const { iu, img, click } = gamUrls(cfg, name, size, ctx.templateId, cacheBuster);
  const label = `<div style="font-family:${SANS};font-size:10px;letter-spacing:1px;color:#9a9a9a;text-transform:uppercase;padding-bottom:4px;">Advertisement</div>`;
  let creative;
  if (cfg.mode === 'gam') {
    creative = `<a href="${esc(click)}" target="_blank"><img src="${esc(img)}" width="${w}" height="${h}" alt="Advertisement" style="display:block;width:${w}px;max-width:100%;height:auto;border:0;"></a>`;
  } else {
    const big = h >= 200;
    creative = `<a href="${esc(click)}" target="_blank" style="text-decoration:none;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${w}" style="width:${w}px;max-width:100%;"><tr>
<td align="center" valign="middle" height="${h}" style="height:${h}px;background:#eef3fd;border:1px dashed #4285f4;font-family:${SANS};color:#3c4043;">
<div style="font-size:${big ? 15 : 12}px;font-weight:bold;color:#1a73e8;">Google Ad Manager &middot; ${esc(size)}</div>
${big ? `<div style="font-size:12px;color:#5f6368;padding-top:6px;">Dummy creative for slot</div><div style="font-size:11px;color:#5f6368;padding-top:2px;font-family:Consolas,monospace;">${esc(iu)}</div>` : `<div style="font-size:10px;color:#5f6368;font-family:Consolas,monospace;">${esc(iu)}</div>`}
</td></tr></table></a>`;
  }
  return `<tr><td align="center" style="padding:16px 0;" data-ad-slot="${esc(name)}">${label}${creative}</td></tr>`;
}

/** Context passed to every template. */
function makeContext(nl, templateId, opts = {}) {
  return {
    nl,
    opts,
    templateId,
    cacheBuster: opts.cacheBuster || String(Date.parse(nl.generatedAt) || Date.now()).slice(-8),
    accent: opts.accentColor || nl.publication.accentColor || '',
    browserUrl: opts.webViewUrl || '[WEBVIEW_URL]',
    unsubscribeUrl: opts.unsubscribeUrl || '[UNSUBSCRIBE_URL]',
  };
}

function footer(ctx, { bg = '#1f1f1f', color = '#bdbdbd', link = '#ffffff' } = {}) {
  const p = ctx.nl.publication;
  return `<tr><td class="px" style="background:${bg};padding:24px 32px;font-family:${SANS};font-size:12px;line-height:18px;color:${color};text-align:center;">
<div style="font-weight:bold;color:${link};font-size:13px;padding-bottom:6px;">${esc(p.name)}</div>
<div>You are receiving this because you subscribed to ${esc(p.name)} updates.</div>
<div style="padding-top:8px;"><a href="${esc(ctx.unsubscribeUrl)}" style="color:${link};text-decoration:underline;">Unsubscribe</a>${p.url ? ` &nbsp;|&nbsp; <a href="${esc(p.url)}" style="color:${link};text-decoration:underline;">Visit website</a>` : ''}</div>
</td></tr>`;
}

function logo(ctx, { height = 40, color = '#111111', font = SANS, size = 26 } = {}) {
  const p = ctx.nl.publication;
  // Known logo dimensions give the image a real width (AMP email needs one).
  const width = p.logoWidth && p.logoHeight ? Math.min(240, Math.round((p.logoWidth * height) / p.logoHeight)) : 0;
  const inner = p.logo
    ? `<img src="${esc(p.logo)}" height="${height}"${width ? ` width="${width}"` : ''} alt="${esc(p.name)}" style="display:inline-block;height:${height}px;width:${width ? `${width}px` : 'auto'};max-width:240px;">`
    : `<span style="font-family:${font};font-size:${size}px;font-weight:bold;color:${color};">${esc(p.name)}</span>`;
  return p.url ? `<a href="${esc(p.url)}" target="_blank" style="text-decoration:none;">${inner}</a>` : inner;
}

/** The line under the masthead logo: when the stories were last built. */
function updatedLine(ctx, { color = '#666666', padding = '0 32px 14px' } = {}) {
  return `<tr><td align="center" style="padding:${padding};font-family:${SANS};font-size:12px;color:${color};">Updated ${esc(formatDate(ctx.nl.generatedAt, ctx.opts))}</td></tr>`;
}

module.exports = { esc, SANS, SERIF, formatDate, shell, button, image, byline, adSlot, adConfig, gamUrls, makeContext, footer, logo, updatedLine };
