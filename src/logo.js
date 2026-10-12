'use strict';
/**
 * Publisher logos for the email masthead. Email clients need a raster image
 * with known dimensions on an https URL we control, so logos are downloaded
 * (or taken from the publisher's upload), SVGs are rasterised in headless
 * Chromium, and the result is stored and served next to the newsletter.
 */
const { httpFetch, getBrowser, PROFILES } = require('./fetcher');

const MAX_W = 240;
const MAX_H = 64;

/** Width/height/type of a PNG, JPEG, GIF or WebP buffer, or null. */
function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 3) === 'GIF') return { type: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { type: 'webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { type: 'webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

const isSvg = (buf) => /<svg[\s>]/i.test(buf.slice(0, 2000).toString('utf8'));

/** Render an SVG to a transparent PNG about MAX_H*2 pixels tall. */
async function rasterizeSvg(svg) {
  const browser = await getBrowser();
  if (!browser) return null;
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  try {
    const html = `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;height:${MAX_H}px;width:auto;max-width:${MAX_W * 2}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`;
    await page.setContent(html);
    const img = page.locator('img');
    await img.waitFor({ timeout: 5000 });
    const png = await img.screenshot({ omitBackground: true, type: 'png' });
    return png;
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

/** Turn downloaded/uploaded bytes into { buffer, type, width, height } or null. */
async function normalizeLogo(buf) {
  if (!buf?.length) return null;
  if (isSvg(buf)) {
    const png = await rasterizeSvg(buf.toString('utf8'));
    if (!png) return null;
    buf = png;
  }
  const size = imageSize(buf);
  if (!size || !size.width || !size.height) return null;
  return { buffer: buf, ...size };
}

async function downloadLogo(url) {
  if (!/^https?:\/\//i.test(url || '')) return null;
  try {
    const res = await httpFetch(url, { headers: { 'User-Agent': PROFILES[0]['User-Agent'], Accept: 'image/png,image/jpeg,image/*,*/*;q=0.5' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return await normalizeLogo(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Size the logo fits at in the masthead box. */
function displaySize({ width, height }) {
  const scale = Math.min(MAX_W / width, MAX_H / height, 1);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

module.exports = { imageSize, normalizeLogo, downloadLogo, displaySize };
