'use strict';
/**
 * Sending a publisher newsletter as a three-part email: text/plain,
 * text/x-amp-html (live stories) and text/html, in that order, which is what
 * Gmail requires to pick the AMP part.
 *
 * Configure any SMTP provider (Gmail with an app password, Amazon SES,
 * SendGrid, Postmark, ...):
 *   SMTP_URL=smtps://user:pass@smtp.example.com:465     or
 *   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_SECURE=1
 *   MAIL_FROM="Newsletter <newsletter@example.com>"
 *
 * Gmail only shows the AMP part when the message passes SPF/DKIM and the
 * sender is registered with Google for dynamic email, or (for testing) the
 * sender is allow-listed in the recipient's Gmail settings.
 */
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { renderAmp, renderHtml, renderText, liveJson } = require('./amp-email');

function smtpConfig(env = process.env) {
  if (env.SMTP_URL) return env.SMTP_URL;
  if (!env.SMTP_HOST) return null;
  const port = Number(env.SMTP_PORT) || 587;
  return {
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === '1' : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
  };
}

function sendingStatus(env = process.env) {
  const missing = [];
  if (!smtpConfig(env)) missing.push('SMTP_URL (or SMTP_HOST, SMTP_USER, SMTP_PASS)');
  if (!env.MAIL_FROM && !env.SMTP_USER) missing.push('MAIL_FROM');
  return { configured: missing.length === 0, missing, from: env.MAIL_FROM || env.SMTP_USER || '' };
}

/** Public URLs the email points at. `baseUrl` must be https for the AMP part to load. */
function urlsFor(rec, baseUrl) {
  const base = `${baseUrl.replace(/\/$/, '')}/n/${rec.id}`;
  return {
    live: `${base}/live.json`,
    logo: rec.logo ? `${base}/logo?v=${rec.logo.version}` : '',
    page: base,
  };
}

/** Publication object the renderers take, with the logo pointed at our copy. */
function pubForEmail(rec, baseUrl) {
  const u = urlsFor(rec, baseUrl);
  return { ...rec.publication, logoUrl: u.logo, logoWidth: rec.logo?.width, logoHeight: rec.logo?.height };
}

function emailParts(rec, baseUrl) {
  const publication = pubForEmail(rec, baseUrl);
  const data = liveJson({ articles: rec.articles, builtAt: rec.builtAt });
  return {
    subject: `${publication.name}: ${data.lead[0]?.title || 'Latest stories'}`,
    text: renderText({ publication, data }),
    amp: renderAmp({ publication, liveUrl: urlsFor(rec, baseUrl).live, fallback: data }),
    html: renderHtml({ publication, data }),
  };
}

function message(rec, { to, baseUrl, from }) {
  const parts = emailParts(rec, baseUrl);
  return { from: from || sendingStatus().from || `${rec.publication.name} <newsletter@localhost>`, to, ...parts };
}

async function sendNewsletter(rec, { to, baseUrl }) {
  const status = sendingStatus();
  if (!status.configured) {
    const err = new Error(`Sending is not set up yet. Missing: ${status.missing.join(', ')}.`);
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const transport = nodemailer.createTransport(smtpConfig());
  const info = await transport.sendMail(message(rec, { to, baseUrl, from: status.from }));
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

/** The same email as an .eml file, for testing without a provider. */
function buildEml(rec, { to, baseUrl }) {
  const mail = new MailComposer(message(rec, { to: to || 'you@example.com', baseUrl })).compile();
  return new Promise((resolve, reject) => mail.build((err, buf) => (err ? reject(err) : resolve(buf))));
}

module.exports = { sendNewsletter, buildEml, emailParts, sendingStatus, urlsFor, pubForEmail };
