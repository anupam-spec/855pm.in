# 855pm newsletter builder

Turns a publisher's RSS feed or plain website URL into structured articles (and an RSS feed) for newsletter templates.

## Feed pipeline

`resolveSource(url)` in `src/feed.js` tries, in order:

1. The URL itself as a feed (RSS 2.0, RSS 1.0/RDF, Atom, JSON Feed; broken XML is repaired or parsed loosely).
2. Feeds the page advertises (`<link rel="alternate">`, RSS links).
3. Common feed paths (`/feed`, `/rss`, `/rss.xml`, `/atom.xml`, ...).
4. Scraping the page (JSON-LD plus DOM heuristics), re-rendered in headless Chromium if blocked or thin.
5. News sitemaps from `robots.txt` and well-known paths.
6. Groq, when `GROQ_API_KEY` is set.

It returns `{ source, publication, articles, feedUrl, rss, attempts }`; `rss` is generated RSS 2.0 for sites with no feed of their own.

```sh
npm install
node bin/feed.js https://www.example.com          # summary
node bin/feed.js https://www.example.com --json   # full JSON
node bin/feed.js example.com --rss out.xml        # write generated RSS
npm test
```

Environment: `GROQ_API_KEY`, `GROQ_MODEL`, `FETCH_TIMEOUT_MS`, `DISABLE_HEADLESS=1`, `CHROMIUM_PATH`.
