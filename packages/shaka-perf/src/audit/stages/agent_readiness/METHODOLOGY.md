# Agent Ready - methodology and defensible claims

The "Agent Ready" tab scores how legible a site is to AI agents and answer
engines (ChatGPT, Claude, Perplexity, Google AI Overviews, shopping agents). It
is a directional 0-100 diagnostic (like a Lighthouse score), version-stamped,
with the weighting shown - NOT a guarantee of AI rankings or citations. This file
is the source of truth for what the report may and may not claim. Sourced from a
verified research pass (2026-06-23); see citations inline.

## Score weighting (v1)

| Category | Weight | Why this weight |
|---|---|---|
| Reachable without JavaScript (SSR) | 40 (gating) | The single most directly measurable, evidence-backed AI-visibility factor. |
| Crawler access (robots.txt / sitemap / llms.txt) | 25 | Documented lever for AI-search inclusion, but only for the search/citation bots. |
| Machine-readable structure (structured data + meta) | 20 | Helps machines parse/understand the page. |
| Semantic HTML and content quality | 15 | Helps any extractor pull the real content accurately. |

Gating rules that keep the headline number honest:

1. If the raw (no-JS) fetch failed or was bot-blocked, the report says "we could
   not read your server HTML" for that page instead of scoring a false 0 or 100.
2. SSR is gating: when a page's raw HTML is a near-empty shell (text coverage
   below ~20%), its score is hard-capped at "poor" (<=49) no matter how good the
   other categories are - content a crawler cannot see makes the rest moot.
3. A page-level `noindex` is surfaced as a separate red flag.

## The core, defensible facts

- Most major AI crawlers FETCH HTML but do NOT execute JavaScript: OpenAI
  (GPTBot, OAI-SearchBot, ChatGPT-User), Anthropic (ClaudeBot), Perplexity, Meta,
  ByteDance. Source: Vercel + MERJ analysis of ~500M-1.3B real AI-crawler fetches
  (https://vercel.com/blog/the-rise-of-the-ai-crawler).
- EXCEPTIONS that DO render JS: Google (Gemini via Googlebot WRS), Apple
  (Applebot), Bing/Copilot (Bingbot). Always name these as exceptions; never say
  "no AI crawler runs JavaScript."
- So a client-rendered SPA hands those crawlers a near-empty shell (head tags +
  empty root div, none of the body content). A CSR site can rank on Google yet be
  effectively blank to ChatGPT/Claude/Perplexity. This is the ShakaCode SSR/RSC
  wedge.
- robots.txt distinguishes TRAINING bots from SEARCH/CITATION bots. Blocking
  training-only crawlers (GPTBot, CCBot) has ZERO citation cost and is a
  legitimate owner choice - do NOT penalize it. Blocking the search/citation bots
  (OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, ClaudeBot,
  Claude-User, Claude-SearchBot) reduces how often a site is cited in AI answers.
  Google-Extended is NOT a citation bot: it is Google's training/grounding control
  for Gemini, not the crawler behind Google Search / AI Overviews (that is
  Googlebot), so blocking it carries no citation cost and is reported neutrally.
  Source: https://developers.openai.com/api/docs/bots ,
  https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
- sitemap.xml is an actually-consumed, stronger AI-discovery signal than llms.txt
  (Bing, Jul 2025). llms.txt has near-zero real consumption (~97% never fetched);
  keep it low weight, framed as emerging/optional.
- Structured data (JSON-LD/schema.org) helps machines PARSE/UNDERSTAND a page
  (Microsoft confirmed Bing/Copilot uses it; Google says it aids understanding).
  It is NOT a proven way to rank or get cited - Google says schema is not required
  for AI features and the largest controlled study (Ahrefs) found no citation
  lift. Limit the claim to "helps machines understand the page."

## Phrasing rules (HARD)

- "near-empty" / "effectively empty of content", never "blank" / "empty".
- "most AI crawlers, such as OpenAI, Anthropic, and Perplexity" + name Google /
  Apple / Bing as exceptions. Never "all AI crawlers".
- robots.txt blocking "reduces citation surface", never "removes you from ChatGPT".
- Never claim llms.txt or schema "measurably helps" AI rank/cite a page.
- The score is "a directional diagnostic, not a guarantee"; show the methodology.
- Plain hyphens only; no em or en dashes anywhere (ShakaCode house rule).
