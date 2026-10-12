'use strict';
/**
 * Newsletter template registry.
 *
 *   const { renderAll, render, list } = require('./templates');
 *   const html = render('magazine', newsletterJson, { ads: { mode: 'gam', networkCode: '1234567' } });
 *
 * Options:
 *   ads             see shared.js adConfig (placeholder | gam | none, networkCode, adUnitPrefix, sizes)
 *   accentColor     overrides each template's brand colour
 *   webViewUrl      "View in browser" link (default [WEBVIEW_URL] merge tag)
 *   unsubscribeUrl  unsubscribe link (default [UNSUBSCRIBE_URL] merge tag)
 *   timeZone, locale  date formatting (default Asia/Kolkata, en-IN)
 */
const { makeContext } = require('./shared');

const TEMPLATES = [require('./magazine'), require('./newsfeed'), require('./tiles'), require('./briefing'), require('./digest')];
const BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

function list() {
  return TEMPLATES.map(({ id, name, description }) => ({ id, name, description }));
}

function render(id, newsletter, opts = {}) {
  const t = BY_ID[id];
  if (!t) throw new Error(`Unknown template "${id}". Available: ${Object.keys(BY_ID).join(', ')}`);
  if (!newsletter?.articles?.length) throw new Error('Newsletter has no articles');
  return t.render(makeContext(newsletter, id, opts));
}

function renderAll(newsletter, opts = {}) {
  return Object.fromEntries(TEMPLATES.map((t) => [t.id, render(t.id, newsletter, opts)]));
}

module.exports = { list, render, renderAll, TEMPLATES };
