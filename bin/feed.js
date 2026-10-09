#!/usr/bin/env node
'use strict';
/**
 * Try the feed pipeline on a URL from the command line.
 *
 *   node bin/feed.js <url> [--json] [--rss out.xml] [--limit 25] [--no-enrich]
 *
 * Prints which route worked (feed, scrape, sitemap, llm), the publication,
 * the first articles and every attempt made along the way.
 */
const fs = require('fs');
const { resolveSource } = require('../src/feed');
const { closeBrowser } = require('../src/fetcher');

async function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const url = args.find((a, i) => !a.startsWith('--') && !['--rss', '--limit'].includes(args[i - 1]));
  if (!url) {
    console.error('Usage: node bin/feed.js <url> [--json] [--rss out.xml] [--limit 25] [--no-enrich]');
    return 2;
  }
  try {
    const result = await resolveSource(url, { limit: Number(value('--limit')) || 25, enrich: !flag('--no-enrich') });
    if (value('--rss')) fs.writeFileSync(value('--rss'), result.rss);
    if (flag('--json')) {
      const { rss, ...rest } = result;
      process.stdout.write(JSON.stringify(rest, null, 2) + '\n');
      return 0;
    }
    const { publication: p, articles } = result;
    console.log(`Source:      ${result.source}${result.feedUrl ? ` (${result.feedUrl})` : ''}`);
    console.log(`Publication: ${p.name} <${p.url}>${p.logo ? `\nLogo:        ${p.logo}` : ''}`);
    console.log(`Articles:    ${articles.length}  (with image: ${articles.filter((a) => a.image).length}, with summary: ${articles.filter((a) => a.description).length})`);
    for (const a of articles.slice(0, 8)) console.log(`  - ${a.title}\n    ${a.link}`);
    printAttempts(result.attempts);
    return 0;
  } catch (err) {
    console.error(`Failed: ${err.message}`);
    if (err.attempts) printAttempts(err.attempts, console.error);
    return 1;
  } finally {
    await closeBrowser();
  }
}

function printAttempts(attempts, out = console.log) {
  out('Attempts:');
  for (const a of attempts) {
    const detail = a.error || (a.items != null ? `${a.items} items` : 'ok') + (a.via ? ` via ${a.via}` : '');
    out(`  ${a.ok ? 'ok  ' : 'fail'} ${a.step.padEnd(7)} ${a.url}  ${detail}`);
  }
}

main(process.argv).then((code) => process.exit(code));
