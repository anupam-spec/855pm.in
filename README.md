# 855pm newsletter builder

Turns a publisher's RSS feed or plain website URL into structured articles (and an RSS feed) for newsletter templates.

## Feed pipeline

`resolveSource(url)` in `src/feed.js` tries, in order:

1. The URL itself as a feed (RSS 2.0, RSS 1.0/RDF, Atom, JSON Feed; broken XML is repaired or parsed loosely).
2. Feeds the page advertises (`<link rel="alternate">`, RSS links), plus known off-site feeds (BBC, TOI).
3. Common feed paths (`/feed`, `/rss`, `/rss.xml`, `/atom.xml`, ...); an HTML "RSS feeds" index page found there is followed to the feeds it lists.
4. Scraping the page (JSON-LD plus DOM heuristics), re-rendered in headless Chromium if blocked or thin.
5. News sitemaps from `robots.txt` and well-known paths.
6. Groq, when `GROQ_API_KEY` is set.

Feed items without images are filled from the article pages' Open Graph tags.

It returns `{ source, publication, articles, feedUrl, rss, attempts }`; `rss` is generated RSS 2.0 for sites with no feed of their own.

```sh
npm install
node bin/feed.js https://www.example.com          # summary
node bin/feed.js https://www.example.com --json   # full JSON
node bin/feed.js example.com --rss out.xml        # write generated RSS
npm test
```

Environment: `GROQ_API_KEY`, `GROQ_MODEL`, `FETCH_TIMEOUT_MS`, `DISABLE_HEADLESS=1`, `CHROMIUM_PATH`. Requests honour `HTTPS_PROXY` / `NO_PROXY`.

## Publisher site

`npm start` runs the publisher-facing site on `PORT` (default 8080):

1. A publisher enters their website or feed URL, or uploads an RSS file in our format (`/format` serves a sample; it is what `buildRss` generates).
2. We build the newsletter: their logo in the masthead (from their site, or uploaded; SVGs are rasterised), and below it the time the stories were last built.
3. The dashboard previews the regular and the live (AMP) version, lets them replace the logo or name, and sends the email to an address they type.

The email has three parts: text, AMP and HTML. The AMP part loads its stories from `/n/<id>/live.json` each time it is opened, so readers see the latest stories and a fresh "Updated" time; the site re-checks the publisher's source at most every `REFRESH_SECONDS` (300). Uploaded RSS changes only when the publisher uploads a newer file.

Settings:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_BASE_URL` | https address of the site; emails load the logo and live stories from it |
| `SMTP_URL` or `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Email provider (Gmail app password, SES, SendGrid, Postmark, ...) |
| `MAIL_FROM` | Sender, e.g. `855 PM <newsletter@855pm.in>` |
| `AMP_ALLOWED_SENDER` | Restrict which sender's AMP emails may read live stories (default any) |
| `DATA_DIR`, `REFRESH_SECONDS`, `NEWSLETTER_TZ` | Storage folder, refresh interval, time zone of the "Updated" line (Asia/Kolkata) |

Gmail shows the AMP part only when the email passes SPF and DKIM and the sender is registered with Google for dynamic email (https://developers.google.com/gmail/ampemail/register). For testing, allow-list the sender in Gmail under Settings › General › Dynamic email › Developer settings. Without that, Gmail shows the HTML part.
