# Newsland
A local, personal RSS briefing for Indian market preparation. No API key, paid service or Python package needed. Requires Python 3.10+ and internet access.

## Start
Double-click `Start Newsland.command`, or run `python3 server.py` in this folder. Open http://localhost:8765. Keep the terminal running; Ctrl+C stops it. A different port can be selected with `python3 server.py --port 8766`.

## What works
- Global and India headlines collected from configured RSS feeds every ten minutes while running.
- All, Global, India and Catalysts filters with a dense three-column desktop grid and one-column phone view. The default briefing surfaces Must know and Watch stories; lower-signal headlines stay available under More headlines. Search, topic, watchlist and new-since-last-visit filters can bring matching lower-ranked items back into view.
- Transparent headline triage across policy, economic data, regulation, earnings, energy/geopolitics, market flows and selected company moves. Relevance starts from the headline, then adjusts for India links, market-moving language, official sourcing, duplicate coverage, freshness and your local Useful/watchlist signals.
- Today (24 hours, 72 hours on Monday) and last-seven-days views.
- Conservative near-duplicate headline grouping. Different numeric facts aren't merged.
- Device-local watchlist, hide/useful feedback, and since-last-visit filter.
- Source health and cached-on-outage labels. All dates displayed in IST.

## First-version limits
This is a headline triage aid, not validated financial analysis. It does not extract consensus, verify event claims, or predict price direction. Relevance explanations are transparent category heuristics, not article-specific conclusions. The local Useful button and watchlist can slightly raise matching stories; they do not train a model. Watchlist matching uses text and a few aliases, not a complete ticker map. Near-duplicate grouping may miss paraphrases. Stories without publication dates are excluded from dated views. Free feeds can be delayed, incomplete or unavailable. No sample stories are silently substituted. Review the collapsed More list during the first trading days to catch false negatives.

## Calendar
No invented meeting or earnings times. `data/events.json` starts empty. Add verified entries as:
```json
[{"title":"Verified event title", "at":"2026-10-06T10:00:00+05:30", "source":"https://official-source.example/event", "verified":true}]
```
Replace the example with an actual verified event. Only events for the current IST date appear. BEA’s official calendar is checked hourly while running. Today shows current IST-day entries; This week shows the next seven days. RBI, Fed meetings and company earnings integrations remain pending. Empty BEA coverage must not be treated as an empty market calendar.

## Sources
`sources.json` lists nine starter feeds. A blocked feed is reported, not bypassed. Mint explicitly provides its feeds for personal, noncommercial newsreader use. Do not assume this local reader's content can be republished. Review each source's permissions before adding Telegram redistribution; Telegram is intentionally not connected in v0.1. NDTV Profit, CNBC-TV18, RBI and NSE can be added once suitable endpoints and permissions are verified. Zerodha Pulse aggregates other publishers; check the original source links.

## Collection and testing
`python3 server.py --refresh-only` performs one collection and prints source health. Results are cached locally in `data/cache.json`. Polling is server-side and independent of browser reloads. No aggressive retries, proxy rotation or CAPTCHA bypass. The collector fetches configured public feed URLs only; it does not scrape full articles.

## Privacy
The server binds only to 127.0.0.1. Preferences live in this browser's localStorage. No analytics or external AI calls. Sources receive normal feed requests. Do not expose this development server to the public internet.

## Evidence in the desk brief
The brief shows observed Nifty quotes, quote session dates when supplied by the provider, fetch times, and dated US readings. It does not estimate Gift Nifty. Quotes may be delayed; weekday session labels do not verify exchange holidays or special sessions. Pivot levels use completed daily candles and are calculated references, not guaranteed support/resistance. Missing inputs remain unavailable. Institutional flows require a `data/flows.json` entry with `date`, HTTPS `source`, `verified: true`, and numeric `fii_net_cr` and `dii_net_cr`; legacy unsourced values are excluded. Historical percentile comparisons remain deferred until verified history is available.
