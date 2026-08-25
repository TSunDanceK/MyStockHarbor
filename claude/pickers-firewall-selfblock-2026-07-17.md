# Pickers outage root cause: firewall self-block (node UA on /api/) — 2026-07-17

## STATUS 2026-08-25
- "Plays still self-fetch" is no longer true; app/plays/page.tsx uses
  getPlaysData(SITE_ORIGIN, { cacheOnly: true }).
- app/pickers/page.tsx converted in #369. A sweep of all 249 server-side files
  confirms NO server-side self-fetch of our own origin remains.
- Therefore the "/api/* step (now safe post in-process fix)" precondition below
  is MET, not merely advanced. The per-IP rate limit on /api/* (~20-30/10s) is
  unblocked.
- The BotID exclusion on /api/pickers REMAINS, for a reason that is true today
  rather than inherited: two browser callers (PickersClient, DashboardTicker)
  depend on the route and it is unverified whether both carry the BotID header
  under Basic.
- EARNINGS_BACKFILL_KEY rotation: still open, flagged to owner 2026-08-25. Note
  it gates /api/pickers?force=1, which triggers a full ~700-symbol FMP sweep —
  a spend vector, not only an access one.

*(Everything below this line is the July record, unedited.)*

## STATUS 2026-07-18: RESOLVED + hardened (in-process fix shipped)
- Immediate fix (2026-07-17): owner turned OFF the "Deny node User-Agent on /api/" firewall rule → pickers repopulated.
- Durable fix (2026-07-18, commit `1bf5085`): `PickerResultPage` now reads the payload in-process via new exported `getPickersData()` in `pickersBuilder.ts` — no more `fetch(${origin}/api/pickers)` self-request. Deployed READY, no runtime errors, verified live: `/stocks-near-200-day-moving-average` renders 20 cards with debug line "Universe 553 · Updated 18 Jul 07:05" (real values, not the "Universe Live · Updated Live data" failure fingerprint).
- Net effect: picker pages can no longer be blanked by any firewall/bot rule, and `/api/*` can now be rate-limited/locked down without collateral damage.
- Push caveat: the push landed in 3 commits (a subagent briefly committed a literal `PLACEHOLDER` to PickerResultPage — `47718cd`, then `b16f1dd` pickersBuilder, then `1bf5085` correct final). Both broken intermediates ERRORED at build so were never promoted — no production downtime. History has the stray commits; file tree at HEAD is correct.

## Symptom (original)
After a day of changes, most picker pages (Buy/Sell Signals, Oversold, Overbought, Best Trend, Divergence, ATH/3-Month/20%-from-ATH breakouts, Daily & Weekly MA200, Macro S/R, Last Earnings, Earnings Growth) rendered empty: "No … stocks are currently available from the live picker feed." Only the **plays** pages (Ascending Triangles, Bull Flags, Descending Triangles) still populated. Owner initially attributed it to a cache-TTL change.

## Actual root cause (confirmed)
A **Vercel Firewall custom rule** — "Deny node User-Agent on /api/" (block requests with `User-Agent: node` hitting `/api/*`) — was added during the day's earnings-calendar rate-limit incident. It blocked the site's **own** server-side calls: the picker section pages (`app/components/PickerResultPage.tsx`) server-rendered by doing an HTTP self-fetch `fetch(${origin}/api/pickers, { cache: "no-store" })`, and Node's built-in fetch sends `User-Agent: node`. So every SSR self-call to `/api/pickers` got a 403 → `getPickerData` fell into its `!res.ok` / catch branch → zero entries → empty page. Real browsers (browser UA) and Googlebot (Vercel-verified) passed fine.

Tell-tale sign: the page debug line read "Universe **Live** · Updated **Live data**" — those literal fallback strings are only emitted in the fetch-failed branch.

## Why plays survived
`app/plays/page.tsx` uses the same self-fetch pattern BUT (a) with Next Data Cache (`next: { revalidate: 3600 }`) so a pre-block payload keeps serving, and (b) renders a client component (`PlaysClient`) that re-fetches in the browser if the server payload is null. Picker pages had neither (`no-store`, no client fallback). (Plays still self-fetch; consider the same in-process treatment later, or give them a distinct UA if a narrow node-UA `/api/` block is ever re-added.)

## Firewall state (as of 2026-07-18)
- "Deny node User-Agent on /api/" — REMOVED by owner (was the culprit).
- Deny IP `74.7.241.14` + Deny JA4 `t13d1011h2_61a7ad8aa9b6_3fcd1a44f3e3` — KEPT. These are a REAL attack: daily-view traffic showed 74.7.241.14 (Microsoft/Azure AS) making ~75.7k requests, ~63.9k to `/earnings-calendar`, with a spoofed browser UA (so managed Bot Protection missed it) and that JA4 (77.2k). The JA4 block is the robust one (survives IP rotation); ~98% attacker so low collateral — monitor.
- "Rate limit earnings-calendar" — re-enabled by owner at **60 requests / 10s per IP** on path starting `/earnings-calendar` (was 100). Path-scoped, so it does NOT count `/_next/*` assets, `/api/*`, or picker pages — only page/date-link hits. A hard human session is ~5–15 counted hits; the attacker did thousands/sec. Safe.
- Bot Protection: Challenge non-browser (excl. verified bots) — ON. DDoS mitigation — ON (managed). Attack Challenge Mode — OFF (emergency-only; flip on during an active flood, off after). Block AhrefsBot — ON. AI Bots — Log.
- Next `/api/*` step (now safe post in-process fix): add a tight per-IP rate limit on `/api/*` (~20–30/10s). Was previously impossible because SSR self-fetches came from Vercel's shared egress IP.

## Rate-limit mechanics (for reference)
Vercel rate limits count EVERY matching request from ONE IP. A path-scoped rule only counts requests whose path starts with the given prefix — assets (`/_next/*`) and cross-origin (Google tags) don't count. A lean page view is ~14–16 own-domain requests but only ~1 hits the page path itself. Never put a *site-wide* rate limit (it would count assets and catch power users). Real cost controls live in-app: 300/min FMP budget, pickers lock, 50/hr earnings cap.

## Security TODO
Rotate `EARNINGS_BACKFILL_KEY` in Vercel env — it was shared in plaintext in chat 2026-07-17.
