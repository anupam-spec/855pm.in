'use strict';
/**
 * Resilient HTTP layer used by every scraping step.
 *
 * - Browser-like request headers, rotated between attempts.
 * - Timeouts, retries with exponential backoff, Retry-After support.
 * - Charset detection (header, <meta charset>, XML prolog, BOM).
 * - Detection of anti-bot walls (Cloudflare, Akamai, PerimeterX, DataDome,
 *   captchas, "Access denied" pages) so callers can switch strategy.
 * - Optional headless Chromium fallback (Playwright) for JS-rendered or
 *   challenge-protected pages.
 * - Honours HTTPS_PROXY / HTTP_PROXY / NO_PROXY, which Node's built-in fetch
 *   ignores (sandboxes and corporate networks often require the proxy).
 */
const undici = require('undici');

const PROXY_ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some((k) => process.env[k]);
let proxyAgent;

/** fetch() that goes through the environment's proxy when one is configured. */
function httpFetch(url, init = {}) {
  if (!PROXY_ENV) return fetch(url, init);
  proxyAgent ||= new undici.EnvHttpProxyAgent();
  return undici.fetch(url, { ...init, dispatcher: proxyAgent });
}

const PROFILES = [
  {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Ch-Ua': '"Chromium";v="129", "Not=A?Brand";v="8", "Google Chrome";v="129"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  },
  {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
  },
  {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.8',
  },
];

const FEED_ACCEPT =
  'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5';

const BLOCK_PATTERNS = [
  /<title>\s*just a moment\.{0,3}\s*<\/title>/i,
  /cf-browser-verification|cf_chl_opt|challenge-platform|cf-turnstile/i,
  /<title>\s*attention required!? \| cloudflare/i,
  /<title>\s*access denied\s*<\/title>/i,
  /you don't have permission to access .* on this server/i,
  /px-captcha|perimeterx/i,
  /captcha-delivery\.com|datadome/i,
  /g-recaptcha|h-captcha|hcaptcha\.com/i,
  /request unsuccessful\. incapsula incident/i,
  /<title>\s*(403 forbidden|forbidden|blocked)\s*<\/title>/i,
  /enable javascript and cookies to continue/i,
  /pardon our interruption/i,
];

class FetchError extends Error {
  constructor(message, { url, status, code, blocked, body } = {}) {
    super(message);
    this.name = 'FetchError';
    this.url = url;
    this.status = status;
    this.code = code;
    this.blocked = Boolean(blocked);
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function detectBlock(status, body) {
  if ([401, 403, 407, 429, 451, 503].includes(status)) return true;
  if (!body) return false;
  const head = body.slice(0, 20000);
  // Real pages that merely embed a recaptcha widget are large; walls are small.
  if (body.length < 60000 && BLOCK_PATTERNS.some((re) => re.test(head))) return true;
  return false;
}

function charsetFrom(contentType, bytes) {
  const m = /charset=["']?([\w-]+)/i.exec(contentType || '');
  if (m) return m[1].toLowerCase();
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  const sniff = Buffer.from(bytes.slice(0, 2048)).toString('latin1');
  const meta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff) || /<\?xml[^>]+encoding=["']([\w-]+)["']/i.exec(sniff);
  return meta ? meta[1].toLowerCase() : 'utf-8';
}

function decode(bytes, contentType) {
  const charset = charsetFrom(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  }
}

/**
 * Fetch a URL as text.
 * @returns {Promise<{url:string,status:number,contentType:string,text:string,via:string}>}
 */
async function fetchText(url, opts = {}) {
  const {
    retries = 2,
    timeout = Number(process.env.FETCH_TIMEOUT_MS) || 15000,
    accept,
    maxBytes = 8 * 1024 * 1024,
    allowBlocked = false,
  } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const profile = PROFILES[attempt % PROFILES.length];
    const headers = { ...profile };
    if (accept) headers.Accept = accept;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await httpFetch(url, { headers, redirect: 'follow', signal: ctrl.signal });
      const reader = res.body ? res.body.getReader() : null;
      const chunks = [];
      let total = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > maxBytes) {
            ctrl.abort();
            break;
          }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(Buffer.concat(chunks));
      const contentType = res.headers.get('content-type') || '';
      const text = decode(bytes, contentType);
      const blocked = detectBlock(res.status, text);
      if (res.ok && (!blocked || allowBlocked)) {
        return { url: res.url || url, status: res.status, contentType, text, via: 'http' };
      }
      lastErr = new FetchError(
        blocked ? `Blocked by publisher (HTTP ${res.status})` : `HTTP ${res.status}`,
        { url, status: res.status, blocked, body: text.slice(0, 2000) }
      );
      // 404/410 will not get better with retries.
      if (res.status === 404 || res.status === 410) break;
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 5) * 1000 : 400 * 2 ** attempt);
    } catch (err) {
      const code = err.name === 'AbortError' ? 'TIMEOUT' : err.cause?.code || err.code || 'NETWORK';
      lastErr = new FetchError(`${code === 'TIMEOUT' ? 'Timed out' : 'Network error'} (${code})`, { url, code });
      // DNS failures and bad certificates will not be fixed by retrying.
      if (['ENOTFOUND', 'EAI_AGAIN', 'ERR_INVALID_URL', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) break;
      await sleep(400 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/* ---------------- Headless browser fallback ---------------- */

let browserPromise = null;

async function getBrowser() {
  if (process.env.DISABLE_HEADLESS === '1') return null;
  if (!browserPromise) {
    browserPromise = (async () => {
      let playwright;
      try {
        playwright = require('playwright');
      } catch {
        return null;
      }
      const launchOpts = { headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] };
      if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
      try {
        return await playwright.chromium.launch(launchOpts);
      } catch {
        return null;
      }
    })();
  }
  const browser = await browserPromise;
  if (!browser) browserPromise = null; // allow a later retry
  return browser;
}

/** Render a page in headless Chromium and return the final HTML. */
async function fetchRendered(url, { timeout = 30000 } = {}) {
  const browser = await getBrowser();
  if (!browser) throw new FetchError('Headless browser unavailable', { url, code: 'NO_BROWSER' });
  const context = await browser.newContext({
    userAgent: PROFILES[0]['User-Agent'],
    locale: 'en-US',
    viewport: { width: 1366, height: 900 },
  });
  try {
    const page = await context.newPage();
    // Skip heavy assets - we only need the DOM.
    await page.route('**/*', (route) => {
      const t = route.request().resourceType();
      return ['image', 'media', 'font'].includes(t) ? route.abort() : route.continue();
    });
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    // Give challenge pages / client-side rendering a chance to settle.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    let html = await page.content();
    if (detectBlock(200, html)) {
      await page.waitForTimeout(6000);
      html = await page.content();
    }
    // Trigger lazy-loading of below-the-fold lists.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(1200);
    html = await page.content();
    const status = res ? res.status() : 200;
    if (detectBlock(status === 200 ? 200 : status, html)) {
      throw new FetchError(`Blocked even in headless browser (HTTP ${status})`, { url, status, blocked: true });
    }
    return { url: page.url(), status, contentType: 'text/html', text: html, via: 'headless' };
  } finally {
    await context.close().catch(() => {});
  }
}

async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    if (b) await b.close().catch(() => {});
  }
}

module.exports = { httpFetch, fetchText, fetchRendered, closeBrowser, detectBlock, FetchError, FEED_ACCEPT, PROFILES };
