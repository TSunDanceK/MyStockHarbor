# Crawlable nav block — shipped 18 Aug 2026 (PR #257)

**Closes the top item in `claude/NEXT-SESSION-2026-08-18.md`**, which was itself
the finding in `claude/header-nav-not-crawlable-2026-08-17.md`. Option 2 of that
doc's sketch ("a server-rendered `<nav>` of the same link set"). Option 1 —
rendering dropdown contents in the DOM always and using the portal purely for
positioning — remains the correct end state and is **not** done.

Merged as `fb60354` (squash). Production deployment
`dpl_9PWYxZRxb7mszfbh1DSpHKTdkHjV`, READY.

## What shipped

Two new files plus a wiring change:

- **`lib/navSections.ts`** — the link set as plain data, 61 links across ten
  headings. Client-safe, no server/Redis import, matching `lib/sectors.ts`.
- **`app/components/CrawlableNav.tsx`** — a server component rendering it.
- **`app/layout.tsx`** — renders it in the footer, plus responsive grid CSS
  (5 columns desktop / 2 at ≤720px / 1 at ≤480px).

## Three decisions worth keeping

**1. A collapsed `<details>`, not an expanded footer.**
`layout.tsx` already carried a long comment explaining why the footer was cut
from 29 links to 14 — site-wide footer links are discounted boilerplate, and an
overcrowded footer gets scanned past. Expanding it would have quietly reversed a
reasoned decision. A `<details>` element renders its children into the markup
whether open or closed, so the footer gains **one row** while all 61 links sit in
the HTML regardless. Google indexes accordion content and follows links inside it.

**2. Not a visually-hidden `<nav>`.** Tidier, and it was tempting. But ~60 links
hidden from users and served only to crawlers is the *shape* of a hidden-links
pattern whatever the intent, and a finance site whose whole problem is a shortage
of trust signals should not be making that bet. The `<details>` is a real
affordance a human can use.

**3. `prefetch={false}` on every link, and it is load-bearing.** Next's `<Link>`
prefetches on viewport entry. Without this, expanding the block fires ~61
prefetches at once, most at expensive dynamic picker routes. This site has
blocked its own visitors through exactly that mechanism before — see
`claude/list-link-prefetch-disable-2026-07-21.md`.

Sector entries are built from `SECTORS` in `lib/sectors.ts` rather than
hand-listed, so they cannot drift from the header flyout, the sitemap or the
`/sector` route family.

## Checked before building, not after

The 17 Aug lesson was *check the data exists before building the presentation of
it*. Applied here:

- All 49 static hrefs verified against a real `app/**/page.tsx` before being
  added to the list.
- **`/insights/videos` excluded.** `app/insights/videos` has only a `[videoId]`
  child and no index page. Linking it would have put a 404 on every page of the
  site. This is the one that would have hurt.
- localStorage-dependent entries (Company Earnings, Stock News, Stock Analysis)
  excluded — no stable server-side value. `/stocks` is the crawlable route into
  that family.

## Verification

Production build → `next start` → `curl` → grep raw HTML. Not DevTools.

| Page | Distinct internal hrefs before | After |
|---|---|---|
| `/about` | 19 | **73** |
| `/trading-setups` | 19 | **103** |
| `/learn` | 19 | **97** |
| `/how-to-read-stock-charts` | 19 | **97** |

On `/trading-setups`, **48 of the 61 appear nowhere else on the page.** Every
page renders `data-nav-links="61"` — that attribute exists specifically so a
regression is one `curl | grep` away.

Previously-zero spot checks, all now present: `/pickers`, `/sector`,
`/headlines`, `/markets/spx`, `/overbought-stocks-today`, `/plays/bull-flags`,
`/sector/technology/news`.

`tsc --noEmit` clean · `eslint` clean (only the pre-existing GA-script warning) ·
the Google Fonts stub the sandbox needs was reverted before commit, verified.

**Confirmed on production after merge** by fetching `/markets/spx` and reading
the rendered output. That fetch also re-demonstrated the original defect from the
crawler's side: the header renders as `Pickers▼ Insights▼ Earnings▼ News▼
Analysis▼` — five triggers, zero links behind them — while the 61-link block
below the footer is fully present.

## Known limitation — read this before adding a nav link

`SiteHeader.tsx`'s nav config remains the source of truth for the *interactive*
nav. `lib/navSections.ts` is a **parallel list**, and a link added to one will
not appear in the other. That duplication is the price of shipping this without
refactoring a 1,792-line client component whose entries carry bespoke
`isActive()` predicates.

**Until SiteHeader consumes `lib/navSections.ts`, add nav links in both places.**
Making SiteHeader consume it is the fix that removes the duplication *and*
delivers Option 1 — worth doing as one piece of work rather than two.

## Not included

`package-lock.json` is still out of sync with `package.json` (`npm ci` fails,
`npm install` works). `npm install` fixes it, but it produces ~1,262 lines of
lockfile churn that would have made this diff unreviewable. Still open.

## What this does and does not claim

It puts 61 links one hop from every page, on a site where 582 URLs are
discovered and never crawled and Discovery has been flat at 3%. That is the
mechanism PRs #240 and #241 worked through, applied sitewide.

It is **not** a fix for the 3-backlink problem. Ranking 18th for
`www.mystockharbor.com` — the site's own domain name — is an authority signal,
not a crawlability one, and nothing here touches it.

Do not read a fortnight of GSC movement as proof either way. The metric to watch
is **Discovery as a share of crawl requests**, not the indexed count.

## Next

1. **`force-dynamic` → `revalidate`** on `/insights/[slug]`, `/upcoming-ipos`,
   `/plays/*`, the picker routes, `/earnings-calendar`.
2. **Rebuild `/about` as a proper E-E-A-T page** — crawled fresh 15 Aug and
   declined; on a finance site it feeds trust signals sitewide, and it is
   plausibly closer to the backlink/authority constraint than more crawl work is.
3. **Warm sector/profile data across the earnings window** — the data gap that
   killed the `/earnings-calendar` sector rollup in #256.
4. **SiteHeader consumes `lib/navSections.ts`** — removes the drift risk above
   and delivers Option 1.
5. **Fix `package-lock.json`.**

**Owner-only, still open:** publish or discard the two staged firewall changes ·
fix Search Console ownership (blocking since 1 Aug) · add the repo to the
session's git sources · re-request the three Failed validations.

**Note on scheduling:** `NEXT-SESSION-2026-08-18.md` says the fortnightly check
(`trig_011xe9rtbj9e1GebdYLNH3ae`) fires 1 Sep. That automation retired with the
second account on 17 Aug — **nothing will fire.** The 1 Sep comparison against
the 17 Aug row (Indexed 133, Discovered-never-crawled 582, Discovery 3%,
backlinks 3) has to be run manually.
