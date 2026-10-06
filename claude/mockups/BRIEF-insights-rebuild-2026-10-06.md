# Brief: rebuilding the Insight posts (6 Oct 2026)

> **Update, 6 Oct late:** the owner approved Cowork's mock-up, `insight-page-concept.html` (in this folder). The build spec is **#563 COWORK #133**, which amends #132. It adds:
> - a news-image hero, also used as the share image;
> - a 4-stat "Since this was published" strip;
> - a "Did the level hold?" slider with chart toggles;
> - a reader vote (may ship as PR 2);
> - a right rail: levels today, screens, sector;
> - "More on {TICKER}" cards: Bottlenecks, Capex, Pickers;
> - related insights.
>
> **One template renders all posts, so the 59 old ones get the new page too.** Old body text is kept as written, the derived label wins, and a muted line notes any contradiction. For example, the AMZN post says "just above" its 200-day, but the publish-day close was 2.1% below it.

## Where things stand
- No insight has been published since **28 Jul 2026** (AMZN, RIOT). The daily schedule no longer exists. **59 live posts**, all frozen; their snapshot records were deleted on 6 Oct and rebuild from Tiingo.
- **Old selection rule:** Post A was a "retail favourite in accumulation", from Stocktwits/Reddit chatter (gave RIOT, BBAI and similar). Post B was a "blue-chip at its 200-day buy zone".
- **Problems seen on `/insights/amzn-daily-ma200-buy-zone-july-2026`:**
  1. **Conflicting labels:** the slug says "buy zone", the tag says "BREAKDOWN RISK", and the snapshot says "Range / Mixed".
  2. **Stale with no outcome:** it was written two days before the 30 Jul earnings and never says what happened next.
  3. **The same sentence appears 3–4 times:** "Simple view", "Setup summary" and "What to watch next", with the news and earnings boxes repeating the body.
  4. **Unsourced figures:** the Alphabet $205bn capex, Tesla $25bn and AMZN FCF $1.2bn have no links. The site now has SEC-filed FCF and earnings it could use instead.
  5. **Advice-flavoured, childish styling:** "buy zone", "would confirm/invalidate", and emoji headers. The owner wants beginner-friendly, not childish, hedged with "may"/"might".
  6. **None of the site's newer engines are used:** Key levels pole, Price zones, Trend Helper, picker conditions, the SEC earnings snapshot and valuation, sector context, Bottlenecks, and the estimated next report date.
  7. **One frozen chart** with one indicator.

## Owner decisions (6 Oct)
- **Frequency:** 1 post a day, weekdays.
- **Selection:**
  - Big names plus a real event. The universe is the top ~300 by market cap or traded value. An event means one of: earnings this week or just reported; a key-level or 200-day test; a trend flip; a 52-week high or low; a gap of 5% or more.
  - No repeat ticker within 30 days.
  - **Plus one retail-buzz slot a week,** only if the company is also sizeable (e.g. ≥ $10bn cap) and has an event.
- **Old posts:** keep them all, and add a live **"Since this was published"** box. The page code computes it: % move since publication, and whether the post's key level held or broke, and when. No rewriting.
- **Page design:** the mock-up was approved as shown (COWORK #133).
- **First new post:** once the rebuild merges, Cowork writes one on JOBY by hand as a test PR (not merged) for the owner to edit, before any schedule is recreated.

## Tiingo contract
- Every price, level and chart is computed by page code at render.
- **The AI writer is never given Tiingo data.** It gets ticker + event type only, and writes from SEC filings plus sourced public news.
- The selection job hands over tickers and event labels, never prices or bars.
- Check this against `claude/tiingo-contract-and-limits-2026-09-23.md` (Project doc; ask Cowork if you need it).

## Selection job (B, #553 COWORK #181)
A nightly step in the existing `tiingo-eod` job (no new cron) writes `msh:insights:candidates:v1`. It holds the top ~10 candidates as `{symbol, event, eventDate, capBucket, reason}`, ranked by size × event strength, with the 30-day repeats excluded and the weekly buzz pick flagged. There are no prices in it. B posts a week of dry-run lists for the owner to judge first.

## Order
1. **C:** the page and template to COWORK #133, in one PR (the vote may be PR 2). Cowork previews AMZN, RIOT, BBAI and a new-format fixture.
2. **B:** the candidates key (#181).
3. **Cowork:** the JOBY test post, then a new scheduled task (1/day weekdays, plus the weekly buzz slot), written to the new template and candidates key. Creating it needs the owner's OK.
