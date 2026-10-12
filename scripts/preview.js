#!/usr/bin/env node
'use strict';
/**
 * Render every newsletter template from a JSON file.
 *
 *   node scripts/preview.js [input.json] [--out=preview] [--ads=placeholder|gam|none] [--network=6499]
 *
 * input.json is either newsletter JSON (from buildNewsletter) or raw
 * {publication, articles[]} / feed.js parseFeed() output. Writes one .html per
 * template plus index.html (tabbed preview) into the output folder.
 */
const fs = require('fs');
const path = require('path');
const { buildNewsletter } = require('../src/newsletter');
const { renderAll } = require('../src/templates');
const { renderPreviewPage } = require('../src/templates/preview');

const args = process.argv.slice(2);
const flag = (name, def) => (args.find((a) => a.startsWith(`--${name}=`)) || `=${def}`).split('=').slice(1).join('=');
const input = args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'examples', 'sample-feed.json');
const outDir = path.resolve(flag('out', 'preview'));

const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
const newsletter = raw.version === 1 && raw.articles ? raw : buildNewsletter(raw);
const opts = { ads: { mode: flag('ads', 'placeholder'), networkCode: flag('network', '6499') } };

fs.mkdirSync(outDir, { recursive: true });
for (const [id, html] of Object.entries(renderAll(newsletter, opts))) {
  fs.writeFileSync(path.join(outDir, `${id}.html`), html);
  console.log(`${id.padEnd(9)} ${(Buffer.byteLength(html) / 1024).toFixed(1).padStart(6)} KB  ${path.join(outDir, id + '.html')}`);
}
fs.writeFileSync(path.join(outDir, 'newsletter.json'), JSON.stringify(newsletter, null, 2));
fs.writeFileSync(path.join(outDir, 'index.html'), renderPreviewPage(newsletter, opts));
console.log(`preview   ${path.join(outDir, 'index.html')}`);
