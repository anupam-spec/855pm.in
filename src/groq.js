'use strict';
/**
 * Optional Groq (OpenAI-compatible) helpers. Every function degrades to a
 * no-op when GROQ_API_KEY is not set or the API fails, so the pipeline never
 * depends on the LLM to produce a newsletter.
 */

const { httpFetch } = require('./fetcher');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const enabled = () => Boolean(process.env.GROQ_API_KEY);
const model = () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

async function chatJson(system, user, { maxTokens = 2048, timeout = 30000 } = {}) {
  if (!enabled()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await httpFetch(GROQ_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model(),
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the LLM to pick article links out of a page's "text -> url" digest. */
async function extractArticlesWithLlm(digest, pageUrl) {
  const out = await chatJson(
    'You extract news/blog article links from a website homepage. Reply with JSON only.',
    `Homepage: ${pageUrl}
Below are anchor texts and their URLs ("text -> url"). Return the 20 most important, most recent editorial ARTICLES (not section pages, tags, authors, login, app links or ads), keeping homepage order.
Respond as {"articles":[{"title":"...","link":"...","category":"..."}]}.

${digest}`,
    { maxTokens: 3000 }
  );
  return Array.isArray(out?.articles) ? out.articles.filter((a) => a && a.title && a.link) : [];
}

/** Subject line, preheader, and 1-2 sentence blurbs for articles missing one. */
async function polishNewsletter(publication, articles) {
  const list = articles.slice(0, 20).map((a, i) => ({ i, title: a.title, description: (a.description || '').slice(0, 300) }));
  const out = await chatJson(
    'You are a newsletter editor. Write in the same language as the headlines. Reply with JSON only.',
    `Publication: ${publication.name}
Articles: ${JSON.stringify(list)}
Return {"subject":"<= 70 chars, compelling, no clickbait","preheader":"<= 110 chars","intro":"one friendly sentence","summaries":[{"i":0,"summary":"1-2 sentence neutral summary (max 200 chars)"}],"categories":[{"i":0,"category":"one or two word section label"}]}`,
    { maxTokens: 3500 }
  );
  return out || null;
}

module.exports = { enabled, model, extractArticlesWithLlm, polishNewsletter };
