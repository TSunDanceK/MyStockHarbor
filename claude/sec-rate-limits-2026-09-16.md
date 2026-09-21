# What bounds /stock/[symbol]/earnings — 2026-09-16

Three limits apply to the earnings page, at three different layers. Only two of
them live in this repository, and the third is the one most likely to be
forgotten, which is why it is written down here.

## 1. Per IP — the Vercel Firewall, not code

Two rules, and **the order between them is part of the rule**. The bypass is
evaluated FIRST; a bypass sitting below a challenge does nothing.

    VERCEL FIREWALL BYPASS: Google & Bing crawlers — AS 15169,8075 AND user-agent matches /[Gg]ooglebot|[Bb]ingbot|Mediapartners-Google|AdsBot-Google|Google-InspectionTool/ — Bypass, ABOVE the rate limit
    VERCEL FIREWALL: /stock — 25 requests / 600s per IP — Challenge

Both configured in the Vercel dashboard (Project → Firewall), **not** in this
repository. They run at the edge, before any lambda, and cost zero Redis
commands.

### Why the crawler bypass exists

`/stock/*` is 483 of the ~765 URLs in the sitemap. A crawler challenged at 25
requests per ten minutes would have most of the indexable site fall out of
Google with **no visible symptom on the live domain** — the pages keep serving
to humans while the index quietly empties. That is the same reasoning
`middleware.ts` already carries for its own `isKnownGoodBot` allowlist on
`/stock/*`, and the middleware version cannot help here: the firewall runs
BEFORE the lambda, so by the time middleware could allow a crawler through, the
challenge has already been served.

### Why ASN alone was rejected

AS 15169 is Google and AS 8075 is Microsoft — **the whole of GCP and the whole
of Azure**. A bypass on ASN alone would exempt every VM, function and scraper
anyone runs on either cloud, which is most of the traffic the rate limit exists
to bound. The user-agent condition is what narrows it to the crawlers.

Conversely the user-agent alone would be worthless: a header is a claim anyone
can make, and `curl -A Googlebot` would walk straight past the limit. **Neither
condition is sufficient and the rule needs both** — the ASN makes the claim
checkable, the user-agent makes the ASN specific. That is verified-crawler
identification in the same sense Google's own reverse-DNS check is: traffic
claiming to be Googlebot *from Google's own network*.

### Why those ASNs are NOT on the datacenter block list

The obvious-looking alternative — block AS 15169 and AS 8075 outright and skip
the bypass — would break things that are wanted:

- **Link previews.** Slack, Discord, WhatsApp, iMessage and X fetch Open Graph
  tags from cloud IPs; a blocked preview is a shared link that renders as a bare
  URL.
- **Ads crawlers.** `Mediapartners-Google` and `AdsBot-Google` are in the
  bypass list precisely because they are wanted, and both originate in AS 15169.
- **AI assistants.** A large share of assistant and answer-engine fetchers run
  on Azure (AS 8075). Blocking that ASN removes the site from them entirely.

So the ASNs stay unblocked and the bypass is narrowed by user-agent instead.

### Keeping the record honest

**This is the per-IP bound, and there is deliberately no per-IP logic in the
code.** The middleware alternative — one Redis `EXISTS` on the fact-set key per
earnings *request*, to tell a cold request from a warm one before counting — was
considered and refused: it duplicates a rule the edge already enforces, at a
per-request cost on a meter already under pressure, in the one place where
reading the client address (`headers()`) turns an ISR route into a 500.

At 25 requests per 600s, a single address cannot reach the 20-cold-fetches-per-
minute site budget below at all, so the case the site-wide bucket cannot defend
against is closed at the layer above it.

**A rule that lives outside the repo is a rule that silently stops being true.**
So both lines are written into `lib/server/secColdFetch.ts`'s `claimColdFetch`
docblock as well, and `scripts/check-sec-rate-limits.mjs` asserts the two copies
agree field for field. If a dashboard rule is ever changed, change both copies —
the check cannot see the dashboard, only whether the repo still agrees with
itself.

The bypass line records its ORDER (`ABOVE the rate limit`) because order is the
one property of it that can be wrong while every field is right, and the failure
is silent: the crawler is challenged and the index drains anyway.

## 2. Site-wide external fetches — `SEC_COLD_FETCHES_PER_MINUTE`

`lib/server/secColdFetch.ts`. One minute-resolution Redis bucket, INCR with a
120s expiry (not 60: a bucket created at :59 would otherwise hand the next
second a fresh allowance). Past the cap the symbol is **queued**, not failed,
and the page renders pending.

It counts FETCHES, not requests: a visitor reading twenty cached pages spends
nothing.

Fails **open** — a Redis error lets the fetch through, because refusing there
costs a reader their page.

Exhaustion is counted, not just logged: `msh:sec:cold-exhausted:v1:<UTC date>`,
incremented only on the exhausted path, kept 14 days, shown on `/cache-health`.
That counter is the decision procedure for whether per-IP isolation in code ever
has a case. If it stays at zero, it never did.

## 3. SEC's own fair-access policy

10 requests/second, published. The site budget of 20/minute is two orders of
magnitude inside it, and the cron's own pacing (8 req/s, 1920 requests per run)
is the larger consumer by far. Neither path can approach the published limit.

## What was REMOVED, and why it is not a fourth limit

A refresh-on-view path had its own 10/minute bucket, a per-symbol hourly
cooldown and a 60s lock. It was removed in #469: `revalidatePath` is refused
from a page render's `after()`, so it corrected sets it could not flush, and the
ISR cache meant the visitor who triggered a refresh was the only one who could.
Its three Redis prefixes are gone. See `secColdFetch`'s populated branch for the
full reasoning.
