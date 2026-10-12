'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildNewsletter } = require('../src/newsletter');
const { list, render, renderAll } = require('../src/templates');
const { renderPreviewPage } = require('../src/templates/preview');

const sampleFeed = require(path.join(__dirname, '..', 'examples', 'sample-feed.json'));
const nl = buildNewsletter(sampleFeed, { now: new Date('2026-10-09T13:00:00Z') });

test('buildNewsletter normalises feed.js parseFeed output', () => {
  assert.equal(nl.publication.name, 'Sample Daily');
  assert.equal(nl.publication.url, 'https://www.example.com/');
  assert.equal(nl.articles.length, sampleFeed.items.length);
  assert.match(nl.subject, /^Sample Daily: /);
  assert.ok(nl.preheader.length > 0);
});

test('buildNewsletter accepts {publication, articles} and drops unusable or duplicate items', () => {
  const out = buildNewsletter({
    publication: { url: 'https://news.example.org' },
    articles: [
      { title: 'A', link: 'https://news.example.org/a?utm_source=x' },
      { title: 'A again', link: 'https://news.example.org/a/' },
      { title: 'No link' },
      { title: 'Bad scheme', link: 'javascript:alert(1)' },
      { title: '', link: 'https://news.example.org/c' },
      { title: 'B', link: 'https://news.example.org/b', image: 'data:image/png;base64,xx' },
    ],
  });
  assert.deepEqual(out.articles.map((a) => a.title), ['A', 'B']);
  assert.equal(out.articles[1].image, '');
  assert.equal(out.publication.name, 'News');
});

test('buildNewsletter applies Groq polish when given', () => {
  const out = buildNewsletter(sampleFeed, {
    polish: { subject: 'Big day', preheader: 'Pre', intro: 'Hello', summaries: [{ i: 0, summary: 'Short.' }] },
  });
  assert.equal(out.subject, 'Big day');
  assert.equal(out.intro, 'Hello');
  assert.equal(out.articles[0].summary, 'Short.');
});

test('buildNewsletter rejects input without articles', () => {
  assert.throws(() => buildNewsletter({ title: 'x', items: [] }), /No usable articles/);
});

test('five distinct templates are registered', () => {
  const ids = list().map((t) => t.id);
  assert.deepEqual(ids, ['magazine', 'newsfeed', 'tiles', 'briefing', 'digest']);
});

test('every template renders a complete email with all articles and ad slots', () => {
  const all = renderAll(nl);
  for (const [id, html] of Object.entries(all)) {
    assert.match(html, /^<!DOCTYPE html>/, id);
    assert.ok(html.trimEnd().endsWith('</html>'), id);
    for (const a of nl.articles) assert.ok(html.includes(a.link), `${id} missing ${a.link}`);
    assert.ok((html.match(/data-ad-slot=/g) || []).length >= 2, `${id} has too few ad slots`);
    assert.ok(html.includes('securepubads.g.doubleclick.net/gampad/jump'), id);
    assert.ok(!/<script/i.test(html), `${id} must not contain scripts`);
    assert.ok(Buffer.byteLength(html) < 102 * 1024, `${id} exceeds Gmail's 102KB clip limit`);
  }
  const bodies = Object.values(all).map((h) => h.replace(/\s+/g, ''));
  assert.equal(new Set(bodies).size, bodies.length, 'templates should differ');
});

test('ad modes: gam emits image tags, none removes slots', () => {
  const gam = render('newsfeed', nl, { ads: { mode: 'gam', networkCode: '1234567', adUnitPrefix: 'pub/nl' } });
  assert.match(gam, /gampad\/ad\?iu=%2F1234567%2Fpub%2Fnl%2Fnewsfeed_top&amp;sz=320x50/);
  const none = render('newsfeed', nl, { ads: { mode: 'none' } });
  assert.ok(!none.includes('data-ad-slot'));
});

test('article text is HTML-escaped', () => {
  const evil = buildNewsletter({
    publication: { name: 'X <b>', url: 'https://x.example' },
    articles: [{ title: '<img src=x onerror=alert(1)>', link: 'https://x.example/a"b', description: '"quoted" & <tag>' }],
  });
  for (const html of Object.values(renderAll(evil))) {
    assert.ok(!html.includes('<img src=x'), 'title not escaped');
    assert.ok(!html.includes('<tag>'), 'summary not escaped');
    assert.ok(!html.includes('X <b>'), 'publication name not escaped');
  }
});

test('templates cope with a single article and no images', () => {
  const tiny = buildNewsletter({ publication: { url: 'https://tiny.example' }, articles: [{ title: 'Only', link: 'https://tiny.example/1' }] });
  for (const html of Object.values(renderAll(tiny))) assert.ok(html.includes('https://tiny.example/1'));
});

test('render rejects unknown template ids', () => {
  assert.throws(() => render('nope', nl), /Unknown template/);
});

test('preview page embeds every template', () => {
  const page = renderPreviewPage(nl);
  for (const t of list()) assert.ok(page.includes(`id="pane-${t.id}"`));
});
