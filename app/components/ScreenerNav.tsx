"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePickerFilter } from "@/app/components/PickerFilterContext";
import ScreenerFilterSearch from "@/app/components/ScreenerFilterSearch";
import type { AnyFilterKey } from "@/lib/pickerFilters";
import { positiveLastEarningsHidden } from "@/lib/positiveLastEarnings";
import { describePredicate } from "@/lib/screenerFields";
import PickerGlyph, { OpensPageArrow, type GlyphId } from "@/app/components/PickerGlyph";


// `filterKey` turns a category into a real checkbox in filter mode (see
// NavList below) instead of a plain navigation link. Two kinds of key work
// here (see lib/pickerFilters.ts): a `FilterKey` from the 18-condition
// custom builder for categories with an exact one-to-one boolean match
// (e.g. "Oversold" is exactly the `oversold` flag), or a `CategoryFilterKey`
// for everything else -- "is this stock also a member of that category's
// own page right now" (e.g. "Buy Signals" -> `hasBuySignal`), computed for
// every entry regardless of which page it's on (see buildCategoryFlags in
// PickerResultPage.tsx).
//
// `href` is now OPTIONAL: every one of the 18 custom-builder conditions has
// a home here (either on an existing category link, or as its own
// checkbox-only row -- see the Momentum/Volume & Volatility/Moving Averages
// groups below). Conditions with no dedicated live screener page of their
// own (checked -- the closest-sounding pages on the site, e.g.
// /stocks-with-unusual-volume or /stocks-above-200-day-moving-average, are
// static guide articles, not pages built on this picker data) simply have
// no `href`, so they only ever render as a checkbox once filter mode is on
// (see NavList) rather than pretending to link somewhere. Only the three
// chart-pattern plays (Ascending Triangles, Bull Flags, Descending
// Triangles) have no `filterKey`, since they're built from a separate, more
// expensive dataset that was deliberately kept out of every other page's
// payload -- those stay plain links even while filter mode is on.
type NavItem = { href?: string; label: string; glyph: GlyphId; filterKey?: AnyFilterKey; comingSoon?: boolean };
type NavGroup = { heading: string; items: NavItem[] };

// Grouped so the column reads like the Learn sidebar (section
// headers) instead of one long flat list. Every existing screener page is
// represented; order within a group roughly follows how related the setups
// are.
const GROUPS: NavGroup[] = [
  {
    heading: "Screener",
    items: [
      // The no-filter starting point -- pinned at the top so it's clear there is
      // a page you can open that doesn't pre-apply any condition (unlike
      // Overbought/Oversold/etc). Just a link, never a checkbox (no filterKey).
      //
      // Labelled "Advanced Screener", NOT "All Stocks": the list is the
      // analyzed universe (a few hundred symbols), not every listed stock, so
      // "All Stocks" over-promised. "Advanced Screener" also matches what this
      // page is called in the top-nav Pickers dropdown and in its own H1, so
      // the same destination isn't given three different names.
      { href: "/stock-screener", label: "Advanced Screener", glyph: "advanced-screener" },
      // Greyed "coming soon" until launch -- the /popular-searches page itself
      // is IP/preview-gated (see middleware.ts), so the public sees a Coming
      // Soon placeholder if they click through; the owner sees the real page.
      { href: "/popular-searches", label: "Popular Searches", glyph: "popular-searches", comingSoon: true },
    ],
  },
  {
    // Hand-written landing pages, each defined by a fundamental screen rather
    // than a technical condition (see claude/preset-pages-universe-blocker-2026-08-04.md).
    // They seed `presetPredicates` -- a numeric bound or a category value --
    // rather than a `filterKey`, so they have no checkbox here and stay plain
    // links even in filter mode, the same as the three Chart Plays below.
    //
    // Listed in the sidebar as well as the header dropdown deliberately:
    // internal linking, not the sitemap, is the binding constraint on getting
    // these indexed -- two independent GSC audits in this repo reached that
    // same conclusion.
    heading: "Popular Screens",
    items: [
      { href: "/low-pe-stocks", label: "Low P/E Stocks", glyph: "low-pe" },
      { href: "/high-dividend-yield-stocks", label: "High Dividend Yield", glyph: "high-dividend-yield" },
      { href: "/dividend-growth-stocks", label: "Dividend Growth", glyph: "dividend-growth" },
      { href: "/cash-rich-value-stocks", label: "Cash-Rich Value", glyph: "cash-rich-value" },
      { href: "/semiconductor-stocks", label: "Semiconductor Stocks", glyph: "semiconductor" },
      { href: "/cheap-tech-stocks", label: "Cheap Tech Stocks", glyph: "cheap-tech" },
    ],
  },
  {
    heading: "Signals",
    items: [
      { href: "/top-stocks-with-buy-signals", label: "Buy Signals", glyph: "buy-signals", filterKey: "hasBuySignal" },
      { href: "/top-stocks-with-sell-signals", label: "Sell Signals", glyph: "sell-signals", filterKey: "hasSellSignal" },
    ],
  },
  {
    heading: "Momentum",
    items: [
      { href: "/oversold-stocks-today", label: "Oversold", glyph: "oversold", filterKey: "oversold" },
      { href: "/overbought-stocks-today", label: "Overbought", glyph: "overbought", filterKey: "overbought" },
      { href: "/best-trend-score-stocks", label: "Best Trend", glyph: "best-trend", filterKey: "bestTrendPick" },
      { href: "/bullish-bearish-divergence-stocks", label: "Divergence", glyph: "divergence", filterKey: "divergencePick" },
      // Finer-grained divergence conditions -- each now has its own dedicated
      // preset page (all stocks matching just that one flag).
      { href: "/bullish-rsi-divergence-stocks", label: "Bullish RSI Divergence", glyph: "bullish-rsi-divergence", filterKey: "bullishRsiDivergence" },
      { href: "/bearish-rsi-divergence-stocks", label: "Bearish RSI Divergence", glyph: "bearish-rsi-divergence", filterKey: "bearishRsiDivergence" },
      { href: "/bullish-macd-divergence-stocks", label: "Bullish MACD Divergence", glyph: "bullish-macd-divergence", filterKey: "bullishMacdDivergence" },
      { href: "/bearish-macd-divergence-stocks", label: "Bearish MACD Divergence", glyph: "bearish-macd-divergence", filterKey: "bearishMacdDivergence" },
    ],
  },
  {
    heading: "Highs & Breakouts",
    items: [
      { href: "/all-time-high-breakout-stocks", label: "ATH Breakouts", glyph: "ath-breakout", filterKey: "athBreakoutPick" },
      { href: "/3-month-high-breakout-stocks", label: "3-Month Highs", glyph: "three-month-high", filterKey: "threeMonthHighPick" },
      { href: "/stocks-down-20-from-all-time-highs", label: "20% From ATH", glyph: "down-20-from-ath", filterKey: "buyTheDip" },
    ],
  },
  {
    heading: "Volume & Volatility",
    items: [
      { href: "/breakout-signal-stocks", label: "Breakout", glyph: "breakout", filterKey: "breakout" },
      { href: "/volume-spike-stocks", label: "Volume Spike", glyph: "volume-spike", filterKey: "volumeSpike" },
      // 2026-10-03 (#553 COWORK #107/#109): the icon was "≈", which now means
      // "estimate" site-wide (A's ESTIMATE_SIGN); "↕" reads as a widening range.
      { href: "/atr-spike-stocks", label: "ATR Spike", glyph: "atr-spike", filterKey: "atrSpike" },
    ],
  },
  {
    heading: "Moving Averages",
    items: [
      { href: "/stocks-near-200-day-moving-average", label: "Near 200-Day", glyph: "near-200-day", filterKey: "dailyMa200Proximity" },
      { href: "/stocks-near-weekly-200-day-moving-average", label: "Weekly MA200", glyph: "near-weekly-200", filterKey: "weeklyMa200Proximity" },
      { href: "/stocks-above-50-day-moving-average", label: "Above MA50", glyph: "above-ma50", filterKey: "aboveMA50" },
      { href: "/stocks-below-50-day-moving-average", label: "Below MA50", glyph: "below-ma50", filterKey: "belowMA50" },
      { href: "/stocks-trading-above-200-day-moving-average", label: "Above MA200", glyph: "above-ma200", filterKey: "aboveMA200" },
      { href: "/stocks-below-200-day-moving-average", label: "Below MA200", glyph: "below-ma200", filterKey: "belowMA200" },
    ],
  },
  {
    // Trend Helper (Slow) direction flips confirmed in the last four bars.
    // Daily and weekly are separate flags, not one flag plus a timeframe
    // control -- the same split /stocks-near-200-day-moving-average and its
    // weekly twin already use.
    heading: "Trend Flips",
    items: [
      { href: "/stocks-with-bullish-trend-flip", label: "Bullish Flip", glyph: "bullish-flip", filterKey: "trendFlipBullish" },
      { href: "/stocks-with-bearish-trend-flip", label: "Bearish Flip", glyph: "bearish-flip", filterKey: "trendFlipBearish" },
      { href: "/stocks-with-weekly-bullish-trend-flip", label: "Bullish Flip (W)", glyph: "bullish-flip-weekly", filterKey: "trendFlipBullishWeekly" },
      { href: "/stocks-with-weekly-bearish-trend-flip", label: "Bearish Flip (W)", glyph: "bearish-flip-weekly", filterKey: "trendFlipBearishWeekly" },
    ],
  },
  {
    heading: "Earnings",
    items: ([
      { href: "/stocks-with-positive-last-earnings", label: "Last Earnings", glyph: "last-earnings", filterKey: "positiveLastEarnings" },
      { href: "/stocks-with-strong-earnings-growth", label: "Earnings Growth", glyph: "earnings-growth", filterKey: "strongEarningsGrowth" },
      // Hidden 2026-09-27 (#553 COWORK #64): see lib/positiveLastEarnings.ts.
    ] satisfies NavItem[]).filter((item) => !positiveLastEarningsHidden(item.href)),
  },
  {
    heading: "Chart Plays",
    items: [
      { href: "/macro-support-resistance-stocks", label: "Macro S/R", glyph: "macro-sr", filterKey: "macroSrPick" },
      // These three come from a separate chart-pattern dataset that was
      // deliberately kept out of every other page's payload (see the
      // ticker-search cost discussion earlier in this project) -- no cheap
      // per-symbol membership flag is available for them, so they stay
      // plain links (with the "opens page" hint below) even in filter mode.
      { href: "/plays", label: "Ascending Triangles", glyph: "ascending-triangle" },
      { href: "/plays/bull-flags", label: "Bull Flags", glyph: "bull-flag" },
      { href: "/plays/descending-triangles", label: "Descending Triangles", glyph: "descending-triangle" },
    ],
  },
];


// Renders the category list. Off, every item with an `href` is a plain
// link (legacy behaviour: tap "Oversold", go to the Oversold page). On
// (`filterMode`), any item with a `filterKey` grows a checkbox in its place
// -- ticking "Oversold" and "Best Trend" combines them via the same AND
// logic /pickers' own filter chips use, narrowing *this* page's own results
// instead of navigating anywhere. Items with no `href` (the checkbox-only
// conditions with no dedicated page -- see GROUPS above) only ever appear
// once filter mode is on; a whole group is skipped entirely if none of its
// items would be visible at the current filterMode. The three chart-pattern
// plays have no filterKey and keep working as plain links even in filter
// mode (with a small "opens page" hint so that's not confusing).
function NavList({
  currentHref,
  onNavigate,
  filterMode = false,
  categoryValues = {},
}: {
  currentHref: string;
  onNavigate?: () => void;
  filterMode?: boolean;
  categoryValues?: Record<string, string[]>;
}) {
  const { selectedFilters, toggleFilter, conditionCounts } = usePickerFilter();

  return (
    <div className="screenerNavList">
      {/* Search first: it reaches every one of the 33 filterable fields plus
          every industry value, none of which could be rendered as a list
          without burying the checkboxes below. Browsing still works -- the
          groups underneath are untouched.

          Sector used to also get its own always-visible checkbox group above
          this search box, but it wrote to the exact same predicate as typing
          a sector name (or "sector" to browse all 11) does here -- same OR-
          together filter, same result, just a second UI pointed at identical
          state. Removed as redundant with the search box that every other
          field already relies on; sector filtering itself is unchanged. */}
      {filterMode ? <ScreenerFilterSearch categoryValues={categoryValues} /> : null}

      {GROUPS.map((group) => {
        const visibleItems = group.items.filter((item) => filterMode || item.href);
        if (!visibleItems.length) return null;

        return (
          <div key={group.heading} className="screenerNavGroup">
            {/* Muted small caps with an accent tick and a hairline (#553 COWORK
                #155): colour is kept for bullish / bearish meaning only, so a
                section no longer gets a colour of its own. */}
            <div className="screenerNavHeading">
              <span className="screenerNavTick" aria-hidden="true" />
              {group.heading}
            </div>
            {visibleItems.map((item) => {
              const active = item.href === currentHref;

              if (filterMode && item.filterKey) {
                const key = item.filterKey;
                const checked = selectedFilters.includes(key);
                const count = conditionCounts ? conditionCounts[key] ?? 0 : null;
                // A 0 is dimmed but still tappable. Disabling it would be the
                // obvious move and the wrong one -- a checkbox that silently
                // refuses to tick is its own puzzle, and unticking something
                // else can make this row live again, which the visitor can
                // only discover if the row still behaves like a control.
                const dead = count === 0 && !checked;
                const rowClass = [
                  "screenerNavItem screenerNavCheckable",
                  checked ? "checked" : "",
                  dead ? "dead" : "",
                ].filter(Boolean).join(" ");

                // With an href the row carries TWO actions, not one: the box
                // filters this page in place, the word opens that condition's
                // own page. So it cannot be a <label> wrapping the lot -- a
                // label hands every tap to its control, and nesting a link
                // inside one is invalid markup besides. The row becomes a plain
                // div, the input gets an aria-label of its own, and the hit
                // area around it is padded out (see .screenerNavCheck) so the
                // tick target stays thumb-sized now that the text is no longer
                // part of it.
                //
                // This also puts the internal links back. Once every picker
                // page switched to filter mode, these rows stopped rendering as
                // links at all, so the whole site had no path into the
                // condition pages except the header dropdown -- despite those
                // pages carrying explainers and chart deep links nothing else
                // has.
                if (item.href) {
                  return (
                    <div key={item.filterKey} className={rowClass}>
                      <span className="screenerNavCheck">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFilter(key)}
                          aria-label={
                            count == null
                              ? `Filter this page by ${item.label}`
                              : `Filter this page by ${item.label}, ${count} of the current results match`
                          }
                        />
                      </span>
                      <PickerGlyph id={item.glyph} dim={dead} />
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        className="screenerNavLabelLink"
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="screenerNavLabel">{item.label}</span>
                        {/* "none today" in place of a 0 pill (#553 COWORK #155):
                            the name dims, the box stays a live control. */}
                        {dead ? (
                          <span className="screenerNavNone" aria-hidden="true">none today</span>
                        ) : count != null ? (
                          <span className="screenerNavCount" aria-hidden="true">{count}</span>
                        ) : null}
                        <span className="screenerNavGo" aria-hidden="true">›</span>
                      </Link>
                    </div>
                  );
                }

                // No page to open, so the whole row is still just the checkbox
                // and the label can go on doing its normal job.
                return (
                  <label key={item.filterKey} className={rowClass}>
                    <input type="checkbox" checked={checked} onChange={() => toggleFilter(key)} />
                    <PickerGlyph id={item.glyph} dim={dead} />
                    <span className="screenerNavLabel">{item.label}</span>
                    {dead ? (
                      <span className="screenerNavNone">none today</span>
                    ) : count != null ? (
                      <span className="screenerNavCount">{count}</span>
                    ) : null}
                  </label>
                );
              }

              if (!item.href) return null;

              // Greyed "coming soon" entry -- still links through (owner sees
              // the real gated page; public sees the Coming Soon placeholder),
              // just visually marked as not-yet-public with a "Soon" pill.
              if (item.comingSoon) {
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={active ? "screenerNavItem active" : "screenerNavItem"}
                    style={{ opacity: 0.55 }}
                    title="Coming soon"
                  >
                    <PickerGlyph id={item.glyph} />
                    <span className="screenerNavLabel">{item.label}</span>
                    <span
                      style={{
                        marginLeft: "auto",
                        flex: "0 0 auto",
                        fontSize: 9.5,
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: "rgba(148,163,184,0.72)",
                        border: "1px solid rgba(148,163,184,0.32)",
                        borderRadius: 999,
                        padding: "1px 6px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Soon
                    </span>
                  </Link>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={active ? "screenerNavItem active" : "screenerNavItem"}
                  aria-current={active ? "page" : undefined}
                >
                  <PickerGlyph id={item.glyph} />
                  <span className="screenerNavLabel">{item.label}</span>
                  {/* A small arrow, not the OPENS PAGE text (#553 COWORK #155). */}
                  {filterMode ? (
                    <span className="screenerNavHint" title="Opens page">
                      <OpensPageArrow />
                      <span className="screenerNavSr">opens page</span>
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// Plain navigation link that replaces the old in-place filter-mode toggle
// on every page except the dedicated /custom-screener page (see
// `alwaysFilterMode` on the default export below). Ticking boxes to combine
// conditions within a single category's own narrow list was fundamentally
// broken -- a stock on the Oversold page can never also be Overbought, so
// any two-condition combination scoped to one category's own short list
// always showed zero matches -- so in-place filtering has been retired in
// favour of sending people to /stock-screener, which searches the full
// analyzed universe instead of one category's own short list.
function OpenCustomScreenerLink() {
  return (
    <div className="screenerFilterModeBar">
      <Link
        href="/stock-screener"
        className="screenerFilterModeBtn"
        onClick={() => {
          // Signal the All Stocks screener to re-open the "Select Screener"
          // overlay on arrival (mobile only) so the menu switches straight to
          // its filter checkboxes -- the page loads behind it -- instead of
          // closing and forcing a second "Select Screener" tap. Read + cleared
          // one-shot by ScreenerNav's mobile trigger below. (/stock-screener is
          // also alwaysFilterMode, so it honours the flag just like the old
          // /custom-screener page did.)
          try {
            sessionStorage.setItem("openScreenerOverlayOnLoad", "1");
          } catch {
            /* sessionStorage unavailable -- link still navigates normally */
          }
        }}
      >
        Open Full Stock Screener
      </Link>
    </div>
  );
}

// Shown at the top of the screener menu on the /custom-screener page
// (alwaysFilterMode) -- a one-tap way back to the picker pages. Points at the
// Buy Signals page, the default landing picker page.
function BackToPickersLink() {
  return (
    <div className="screenerFilterModeBar">
      <Link href="/top-stocks-with-buy-signals" className="screenerFilterModeBtn">
        ← Back to Pickers
      </Link>
    </div>
  );
}

// The "N matching" + Clear row that used to live under the (now-removed)
// filter-mode toggle button. Only rendered when `alwaysFilterMode` is on
// (i.e. only on /custom-screener, the one page where NavList's checkboxes
// are always showing) -- every other page's NavList always renders plain
// links now, so selectedFilters never becomes non-empty there and this has
// nothing to show.
function FilterSummaryBar() {
  const { selectedFilters, selectedSectors, matchCount, clearFilters } = usePickerFilter();
  if (!selectedFilters.length && !selectedSectors.length) return null;

  return (
    <div className="screenerFilterModeBar">
      <div className="screenerFilterModeMeta">
        {matchCount != null ? <span className="screenerFilterModeCount">{matchCount} matching</span> : <span />}
        <button type="button" className="screenerFilterClear" onClick={clearFilters}>
          Clear
        </button>
      </div>
    </div>
  );
}

// `variant` lets callers split the desktop sidebar and the mobile
// "Select Screener" trigger into two separate places in the page layout
// (each variant renders its own independent open/close state -- only one
// of the two is ever visible at a given viewport width via the existing
// CSS breakpoint, so there's no conflict):
//   - "full" (default): sidebar + trigger, same position (legacy behaviour)
//   - "sidebar": desktop sticky column only, no mobile trigger/overlay
//   - "trigger": mobile "Select Screener" button + overlay only, no sidebar
//
// `showFilters` renders the checkbox-aware NavList's supporting UI (see
// above); it does nothing unless the caller also wraps the page in
// <PickerFilterProvider>. When `alwaysFilterMode` is false (every existing
// category page), NavList always renders plain links and, if `showFilters`
// is on, a plain link to /stock-screener (OpenCustomScreenerLink) replaces
// what used to be the "Open Filters" toggle button -- in-place per-category
// checkbox filtering has been retired (see OpenCustomScreenerLink's comment
// for why) in favour of that dedicated page. When `alwaysFilterMode` is
// true (the All Stocks screener passes this), NavList always renders
// checkboxes and there's no toggle at all, just the always-visible
// checkboxes plus a "Back to Pickers" link and a "N matching" + Clear
// summary row (FilterSummaryBar) once at least one is checked.
// `showSearch` is retained for backwards compatibility with existing
// callers but is no longer used: the old cross-picker ticker search that
// used to render in the mobile overlay has been removed (see below). The
// only ticker search on the site now is the All Stocks symbol search
// in the hero (CustomScreenerSymbolSearch, see PickerResultPage.tsx).
export default function ScreenerNav({
  currentHref,
  variant = "full",
  showFilters = false,
  alwaysFilterMode = false,
  compact = false,
  categoryValues = {},
}: {
  currentHref: string;
  variant?: "full" | "sidebar" | "trigger";
  showFilters?: boolean;
  showSearch?: boolean;
  alwaysFilterMode?: boolean;
  // Renders the mobile trigger as a single inline pill instead of its own
  // full-width bar, so it can sit in the results controls row alongside the
  // data-tab, sort and view-mode pills.
  //
  // The full-width bar said the same thing twice -- "▾ Select Screener" on the
  // left and "Advanced Screener ▾" on the right, two labels and two chevrons
  // for one action -- and took a whole row of a phone screen to do it. The pill
  // carries the current screener's name only, which is the half that actually
  // tells you anything.
  compact?: boolean;
  // Values present in the calling page's own results for each category field
  // ("sector", "industry", ...), so neither the Sector group nor the search box
  // ever offers something with nothing behind it. See categoryValues in
  // PickerResultPage.tsx.
  categoryValues?: Record<string, string[]>;
}) {
  const [open, setOpen] = useState(false);
  const { matchCount, predicates, selectedFilters, selectedSectors, clearFilters, isPristine } = usePickerFilter();
  const showSidebar = variant !== "trigger";
  const showTrigger = variant !== "sidebar";

  // When arriving from another page's "Open Full Stock Screener" tap on
  // mobile, re-open the overlay immediately so the menu switches straight to
  // the checkboxes (the page itself loads behind it) instead of closing and
  // making the visitor tap "Select Screener" again. One-shot:
  // the flag is cleared the moment it's read. Only the mobile trigger of the
  // All Stocks screener (alwaysFilterMode) honours it, and only at mobile
  // widths so the fixed overlay never covers the desktop layout.
  useEffect(() => {
    if (!showTrigger || !alwaysFilterMode) return;
    try {
      if (sessionStorage.getItem("openScreenerOverlayOnLoad") === "1") {
        sessionStorage.removeItem("openScreenerOverlayOnLoad");
        if (typeof window !== "undefined" && window.matchMedia("(max-width: 980px)").matches) {
          setOpen(true);
        }
      }
    } catch {
      /* sessionStorage unavailable -- no auto-open, no harm */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While the sheet is open the page behind it must not move at all. Two
  // separate things were letting it: touching the backdrop scrolled the page
  // directly, and a swipe that ran the panel's own scroller to its end carried
  // on into the page underneath (scroll chaining -- the CSS side of that is
  // overscroll-behavior on .screenerOverlayScroll below).
  //
  // overflow: hidden on <body> alone is not enough on iOS Safari, which happily
  // scrolls it anyway. Pinning the body with position: fixed at a negative
  // offset is the reliable version: the page is frozen exactly where it was,
  // and the offset is restored on close so closing the sheet doesn't jump you
  // back to the top of a 500-row list.
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  // The pill on the "Select Screener" button names what you are currently
  // looking at, so it has to follow the SELECTION, not the URL. Deriving it from
  // currentHref alone was the bug: on /oversold-stocks-today with Oversold
  // unticked and Overbought ticked, the H1, eyebrow and results chip all said
  // Overbought while the pill still said "Oversold".
  //
  // Only pages with in-place filtering (alwaysFilterMode) can diverge from their
  // own URL, so everywhere else -- and anywhere ScreenerNav renders outside a
  // PickerFilterProvider, e.g. ScreenerShell, where `predicates` is always the
  // inert empty array -- keeps the plain page-name behaviour untouched.
  const currentItem = GROUPS.flatMap((group) => group.items).find((item) => item.href === currentHref);
  const pageLabel = currentItem?.label ?? "Screeners";

  let currentLabel = pageLabel;
  if (alwaysFilterMode) {
    if (isPristine) {
      // The resting state: the selection is still exactly what this page seeded,
      // so the page's own name is the right label. Prefer it over the
      // predicate's description because the two are worded slightly differently
      // in places ("Buy Signals" here vs the CATEGORY_FILTER_DEFS label "Buy
      // Signal"; "20% From ATH" vs "20%+ From ATH"), and because a Popular
      // Screens page seeds two predicates but is still one named thing -- "Cheap
      // Tech Stocks" beats "Custom" for a page that has not been touched.
      //
      // Asking isPristine rather than re-deriving it here is what makes this
      // correct for every seed shape: one flag, several flags, a numeric bound,
      // a category value, or a combination. It also covers /stock-screener,
      // where an empty selection IS the resting state.
      currentLabel = pageLabel;
    } else if (predicates.length > 1) {
      // No point naming them: the count badge beside the pill already says how
      // many, and two labels won't fit at mobile widths anyway.
      currentLabel = "Custom";
    } else if (predicates.length === 1) {
      // describePredicate covers every predicate kind, so a lone sector or
      // numeric filter reads "Sector: Technology" / "PE Ratio under 15" rather
      // than a bare field name.
      currentLabel = describePredicate(predicates[0]);
    } else {
      // Nothing ticked. On a condition page that means the visitor unticked the
      // page's own condition and is now looking at the full universe -- still
      // saying "Oversold" there is the same lie in reverse. On /stock-screener
      // (no filterKey, nothing seeded) an empty selection IS the resting state,
      // so it keeps its own name.
      currentLabel = currentItem?.filterKey ? "No filters" : pageLabel;
    }
  }

  return (
    <>
      {/* Desktop: sticky left column */}
      {showSidebar ? (
        <aside className="screenerSidebar" aria-label="Stock screeners">
          <div className="screenerSidebarTitle">Screeners</div>
          {showFilters ? (
            alwaysFilterMode ? (
              <>
                <BackToPickersLink />
                <FilterSummaryBar />
              </>
            ) : (
              <OpenCustomScreenerLink />
            )
          ) : null}
          <NavList currentHref={currentHref} filterMode={alwaysFilterMode} categoryValues={categoryValues} />
        </aside>
      ) : null}

      {/* Mobile: the trigger that opens the screener overlay. `compact` renders
          it as one inline pill for the results controls row; otherwise it keeps
          its original full-width bar. */}
      {showTrigger ? (
        compact ? (
          <span className="screenerPillWrap">
            <button
              type="button"
              className="screenerPillBtn"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              {/* Sliders, and the word "Screens" rather than the name of the
                  screen you are already on. In the docked bar this is a tab
                  among four, and a tab labelled "Oversold" says what you are
                  looking at -- which the page heading already says -- instead
                  of what pressing it does, which is the only thing a control
                  in that bar has room to say. The count badge still reports
                  applied filters, so state is not lost, only moved to the one
                  element whose job it is. */}
              <svg
                className="screenerPillIcon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h8M16 17h4" />
                <circle cx="16" cy="7" r="2" />
                <circle cx="9" cy="12" r="2" />
                <circle cx="14" cy="17" r="2" />
              </svg>
              <span className="screenerPillLabel">Screens</span>
              {predicates.length ? (
                <span className="screenerSelectCount" aria-label={`${predicates.length} filters applied`}>
                  {predicates.length}
                </span>
              ) : null}
              <span className="screenerSelectChevron" aria-hidden="true">▾</span>
            </button>
          </span>
        ) : (
          <div className="screenerMobileBar">
            <button
              type="button"
              className="screenerSelectBtn"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              <span className="screenerSelectMain">
                <span className="screenerSelectIcon" aria-hidden="true">⏷</span>
                Select Screener
                {predicates.length ? (
                  <span className="screenerSelectCount" aria-label={`${predicates.length} filters applied`}>
                    {predicates.length}
                  </span>
                ) : null}
              </span>
              <span className="screenerSelectCurrent">
                {currentLabel}
                <span className="screenerSelectChevron" aria-hidden="true">▾</span>
              </span>
            </button>
          </div>
        )
      ) : null}

      {showTrigger && open ? (
        <div className="screenerOverlay" role="dialog" aria-modal="true" aria-label="Select screener">
          <div className="screenerOverlayBackdrop" onClick={() => setOpen(false)} />
          <div className="screenerOverlayPanel">
            <div className="screenerOverlayHeader">
              <span>Select Screener</span>
              <button
                type="button"
                className="screenerOverlayClose"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="screenerOverlayScroll">
              {/* Checkboxes (when alwaysFilterMode is on) work exactly like
                  desktop; Clear + Go in the footer are how you clear/finish
                  once you're done ticking boxes. The old cross-picker ticker
                  search that used to sit here has been removed. */}
              {showFilters ? (alwaysFilterMode ? <BackToPickersLink /> : <OpenCustomScreenerLink />) : null}
              <NavList currentHref={currentHref} onNavigate={() => setOpen(false)} filterMode={alwaysFilterMode} categoryValues={categoryValues} />
            </div>
            {showFilters ? (
              <div className="screenerOverlayFooter">
                <div className="screenerOverlayFooterRow">
                  {selectedFilters.length || selectedSectors.length ? (
                    <button type="button" className="screenerFilterClearFixed" onClick={clearFilters}>
                      Clear
                    </button>
                  ) : null}
                  <button type="button" className="screenerGoBtn" onClick={() => setOpen(false)}>
                    Go{matchCount != null ? ` — ${matchCount} matching` : ""}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <style>{`
        .screenerSidebar {
          position: sticky; top: 16px; align-self: start;
          border: 1px solid rgba(255,255,255,0.08); border-radius: 20px;
          padding: 16px 10px;
          background: linear-gradient(180deg, rgba(10,16,28,0.9), rgba(6,10,18,0.96));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
          max-height: calc(100vh - 32px); overflow-y: auto;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;
        }
        .screenerSidebarTitle {
          font-size: 12px; font-weight: 950; letter-spacing: 0.12em; text-transform: uppercase;
          color: #93c5fd; padding: 4px 8px 12px;
        }
        .screenerNavList { display: grid; gap: 14px; }
        .screenerNavGroup { display: grid; gap: 4px; }
        /* Option B (#553 COWORK #155): muted small caps, a 3px accent tick and a
           hairline -- no colour per section. --picker-accent is the neutral
           mark colour shared with PickerGlyph. */
        .screenerNavList { --picker-accent: #38bdf8; }
        .screenerNavHeading {
          display: flex; align-items: center; gap: 8px;
          font-size: var(--fs-fine); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
          color: #64748b; padding: 4px 8px 2px;
        }
        .screenerNavHeading::after { content: ""; flex: 1 1 auto; height: 1px; background: rgba(148,163,184,0.14); }
        .screenerNavTick { flex: 0 0 auto; width: 3px; height: 10px; border-radius: 2px; background: var(--picker-accent); }
        .screenerNavItem {
          /* UNBREAKS THE min-width CHAIN, and this is the actual cause of the
             sidebar's horizontal scrollbar -- not the column being too narrow.
             .screenerNavGroup is a grid, so every row here is a GRID ITEM, and a
             grid item's default min-width is auto: it refuses to shrink below
             its content's min-content width. .screenerNavLabel below already has
             min-width: 0 and an ellipsis and would happily truncate, but the row
             never gets asked to, so it grows wider than the column instead. And
             because .screenerSidebar sets overflow-y: auto, the spec computes
             overflow-x to auto too, so a single pixel of overrun is a scrollbar.
             Worst case is the Chart Plays links: longest labels AND the
             "OPENS PAGE" hint, which is flex: 0 0 auto and nowrap. */
          min-width: 0;
          display: flex; align-items: center; gap: 10px;
          padding: 9px 8px; border-radius: 11px; border: 1px solid transparent;
          color: rgba(226,232,240,0.82); text-decoration: none;
          font-size: 0.875rem; font-weight: 650;
          transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
        }
        .screenerNavItem:hover { background: rgba(255,255,255,0.045); color: #f8fafc; }
        .screenerNavItem.active { color: #f8fafc; font-weight: 950; }
        .pickerGlyph { flex: 0 0 auto; display: block; width: 30px; height: 18px; }
        .screenerNavLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .screenerNavHint { margin-left: auto; flex: 0 0 auto; display: inline-flex; color: #64748b; }
        .screenerNavSr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

        .screenerNavCheckable {
          cursor: pointer;
        }
        /* Selected: a faint accent wash and an inset 2px bar on the left. */
        .screenerNavCheckable.checked {
          background: rgba(56,189,248,0.08); box-shadow: inset 2px 0 0 var(--picker-accent); color: #f8fafc;
        }
        /* The native input, restyled (#553 COWORK #155): 16px, 5px corners, a
           1.5px slate border; filled accent with a dark tick when checked.
           Still the real <input>, so keyboard and screen readers are unchanged,
           and focus stays visible. */
        .screenerNavCheckable input[type="checkbox"] {
          appearance: none; -webkit-appearance: none; margin: 0;
          flex: 0 0 auto; width: 16px; height: 16px; border-radius: 5px;
          border: 1.5px solid #475569; background: transparent; cursor: pointer;
          display: inline-grid; place-items: center;
        }
        .screenerNavCheckable input[type="checkbox"]:checked {
          background: var(--picker-accent) center / 10px 10px no-repeat
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath d='M2 5.2 4.2 7.4 8 3' fill='none' stroke='%2306080d' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          border-color: var(--picker-accent);
        }
        .screenerNavCheckable input[type="checkbox"]:focus-visible { outline: 2px solid var(--picker-accent); outline-offset: 2px; }
        /* Padded hit area around the box. The word next to it is a link now, so
           this is the ONLY way to tick the row -- a bare 16px checkbox is well
           under any sane touch target. Negative margins absorb the extra height
           back into the row so rows do not grow. */
        .screenerNavCheck {
          flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
          width: 36px; height: 34px; margin: -7px -6px -7px -8px; cursor: pointer;
        }
        /* Fills the rest of the row, so tapping anywhere right of the box opens
           the page -- the two targets between them cover the whole row with no
           dead zone. */
        .screenerNavLabelLink {
          display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto;
          color: inherit; text-decoration: none;
        }
        .screenerNavLabelLink:hover .screenerNavLabel { text-decoration: underline; }
        /* Sits hard right of the label, so the counts form a readable column
           down the sheet rather than trailing each label at a different x. */
        .screenerNavCount {
          flex: 0 0 auto; margin-left: auto; padding: 1px 7px; border-radius: 999px;
          font-size: 10.5px; font-weight: 900; font-variant-numeric: tabular-nums;
          background: rgba(148,163,184,0.14); color: rgba(226,232,240,0.82);
        }
        .screenerNavCheckable.checked .screenerNavCount { background: rgba(56,189,248,0.2); color: #e0f2fe; }
        /* Zero: "none today" instead of a 0 pill, and only the NAME dims -- the
           box keeps its full contrast so it still reads as a working control. */
        .screenerNavCheckable.dead .screenerNavLabel { color: #64748b; }
        .screenerNavNone { flex: 0 0 auto; margin-left: auto; font-size: var(--fs-fine); font-weight: 600; color: #64748b; white-space: nowrap; }
        .screenerNavNone + .screenerNavGo { margin-left: 6px; }
        /* The count has taken the auto margin, so the chevron just follows it. */
        .screenerNavCount + .screenerNavGo { margin-left: 6px; }
        .screenerNavGo { flex: 0 0 auto; margin-left: auto; font-size: 16px; line-height: 1; color: rgba(148,163,184,0.5); }
        .screenerNavLabelLink:hover .screenerNavGo { color: #93c5fd; }

        .screenerFilterModeBar { padding: 0 4px 12px; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .screenerFilterModeBtn {
          width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          padding: 9px 12px; border-radius: 10px; border: 1px solid rgba(96,165,250,0.35);
          background: rgba(59,130,246,0.10); color: #dbeafe; font-size: 12.5px; font-weight: 800; cursor: pointer;
          text-decoration: none; box-sizing: border-box;
        }
        .screenerFilterModeBtn.active { background: rgba(34,197,94,0.14); border-color: rgba(34,197,94,0.42); color: #bbf7d0; }
        .screenerFilterModeBadge {
          display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px;
          border-radius: 999px; background: rgba(255,255,255,0.16); font-size: 10.5px; font-weight: 900; padding: 0 5px;
        }
        .screenerFilterModeMeta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; padding: 0 2px; }
        .screenerFilterModeCount { font-size: 11.5px; color: rgba(148,163,184,0.85); font-weight: 700; }

        .screenerFilterClear {
          border: 1px solid rgba(239,68,68,0.28); background: rgba(239,68,68,0.06); color: #fca5a5;
          border-radius: 8px; padding: 4px 9px; font-size: 11px; font-weight: 800; cursor: pointer;
        }

        .screenerSearchGroup { padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .screenerSearchRow { display: flex; gap: 6px; padding: 0 8px; }
        .screenerSearchInput {
          flex: 1 1 auto; min-width: 0; padding: 7px 9px; border-radius: 9px;
          border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.03);
          color: #f1f5f9; font-size: 12.5px; font-weight: 700;
        }
        .screenerSearchInput:focus { outline: none; border-color: rgba(96,165,250,0.55); }
        .screenerSearchBtn {
          flex: 0 0 auto; padding: 7px 12px; border-radius: 9px; border: 1px solid rgba(96,165,250,0.4);
          background: rgba(59,130,246,0.14); color: #dbeafe; font-size: 12px; font-weight: 800; cursor: pointer;
        }
        .screenerSearchBtn:disabled { opacity: 0.5; cursor: default; }
        .screenerSearchNote { margin-top: 8px; padding: 0 8px; font-size: 11.5px; line-height: 1.5; color: rgba(226,232,240,0.7); }
        .screenerSearchChip {
          display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04);
          color: #e2e8f0; font-size: 11.5px; font-weight: 700; text-decoration: none; width: fit-content;
        }
        .screenerSearchSource { margin-left: 4px; font-size: 10px; font-weight: 700; opacity: 0.55; }

        .screenerMobileBar { display: none; }
        /* The compact pill. Hidden on desktop for the same reason the full-width
           bar is: the sidebar is already showing the whole screener list there,
           so a control that opens it as an overlay is redundant. */
        .screenerPillWrap { display: none; }
        .screenerPillBtn {
          display: inline-flex; align-items: center; gap: 7px; max-width: 62vw;
          padding: 9px 15px; border-radius: 999px;
          border: 1px solid rgba(96,165,250,0.4); background: rgba(59,130,246,0.10);
          color: #dbeafe; font-weight: 800; font-size: 12.5px; font-family: inherit;
          cursor: pointer; white-space: nowrap;
        }
        .screenerPillBtn:active { background: rgba(59,130,246,0.2); }
        .screenerPillIcon { flex: 0 0 auto; color: #93c5fd; width: 15px; height: 15px; display: block; }
        .screenerPillLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .screenerSelectCount {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 20px; height: 20px; padding: 0 6px; margin-left: 2px;
          border-radius: 999px;
          background: #22c55e; color: #052e16;
          font-size: 11.5px; font-weight: 950; line-height: 1;
        }
        .screenerSelectBtn {
          width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 14px 16px; border-radius: 16px;
          border: 1px solid rgba(96,165,250,0.35);
          background: rgba(15,23,42,0.6);
          color: #f0f7ff; font-weight: 950; font-size: 15px; cursor: pointer;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
          transition: transform 140ms ease, background 140ms ease, border-color 140ms ease;
        }
        .screenerSelectBtn:active {
          transform: translateY(1px);
          background: rgba(15,23,42,0.78);
        }
        .screenerSelectMain { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 8px; }
        .screenerSelectIcon { font-size: 14px; color: #93c5fd; }
        .screenerSelectCurrent {
          display: inline-flex; align-items: center; gap: 7px; min-width: 0;
          padding: 5px 10px; border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.28); background: rgba(255,255,255,0.08);
          color: rgba(241,245,249,0.95); font-size: 12.5px; font-weight: 900;
          overflow: hidden;
        }
        .screenerSelectCurrent > :not(.screenerSelectChevron) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .screenerSelectChevron { flex: 0 0 auto; color: rgba(226,232,240,0.7); }

        .screenerOverlay {
          position: fixed; inset: 0; z-index: 70; display: flex;
          /* Height is pinned to the *dynamic* viewport (100dvh) so the panel
             — and especially its fixed footer with the Go button — sits above
             mobile Chrome's bottom toolbar instead of behind it. Plain 100vh
             (the inset:0 fallback for browsers without dvh) measures the
             toolbar-hidden viewport on Chrome iOS, which is what clipped the
             footer; dvh tracks the visible area as the toolbar shows/hides.
             Safari already anchored fixed elements above its toolbar, so it
             was unaffected either way. */
          height: 100dvh;
          /* Reserves space at the top for the site's own fixed/sticky
             header so the overlay's "Select Screener" title + close button
             (see .screenerOverlayHeader) never render underneath it. */
          padding-top: calc(64px + env(safe-area-inset-top));
        }
        .screenerOverlayBackdrop {
          position: absolute; inset: 0; background: rgba(2,6,15,0.72);
          -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
        }
        .screenerOverlayPanel {
          position: relative; margin-top: auto; width: 100%;
          /* Fixed "height", not "max-height": with max-height the panel was
             content-driven, so it only filled the screen when the list
             happened to be long enough and otherwise opened as a short slip
             partway up. Fixing the height means it always opens to the same
             full-height sheet regardless of where you were on the page or how
             many groups are visible. */
          height: min(82dvh, calc(100dvh - 76px - env(safe-area-inset-top)));
          display: flex; flex-direction: column;
          border-top-left-radius: 22px; border-top-right-radius: 22px;
          border: 1px solid rgba(255,255,255,0.10); border-bottom: 0;
          background: linear-gradient(180deg, rgba(12,18,30,0.99), rgba(7,11,20,1));
          box-shadow: 0 -18px 50px rgba(0,0,0,0.5);
        }
        .screenerOverlayHeader {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 18px 12px; font-size: 15px; font-weight: 950; color: #f8fafc;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .screenerOverlayClose {
          width: 34px; height: 34px; border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04);
          color: #e2e8f0; font-size: 13px; font-weight: 900; cursor: pointer;
        }
        .screenerOverlayScroll {
          flex: 1 1 auto; overflow-y: auto; padding: 14px 14px 24px;
          /* Keeps a scroll gesture inside this panel once it reaches its top or
             bottom, instead of handing the remainder to the page behind -- which
             is what made scrolling feel like it was moving two things at once. */
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;
        }
        .screenerOverlayFooter {
          flex: 0 0 auto; padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
          border-top: 1px solid rgba(255,255,255,0.10);
          background: rgba(7,11,20,1);
        }
        .screenerOverlayFooterRow { display: flex; align-items: stretch; gap: 10px; }
        .screenerGoBtn {
          flex: 1 1 auto; padding: 13px 16px; border-radius: 12px;
          border: 1px solid rgba(34,197,94,0.4);
          background: linear-gradient(135deg, rgba(34,197,94,0.28), rgba(22,163,74,0.18));
          color: #ecfdf5; font-weight: 950; font-size: 14.5px; cursor: pointer;
        }
        .screenerFilterClearFixed {
          flex: 0 0 auto; padding: 13px 18px; border-radius: 12px;
          border: 1px solid rgba(239,68,68,0.35); background: rgba(239,68,68,0.10);
          color: #fca5a5; font-weight: 900; font-size: 14px; cursor: pointer; white-space: nowrap;
        }

        @media (max-width: 980px) {
          .screenerSidebar { display: none; }
          /* Stickiness lives on the .screenerTriggerWrap wrapper in
             PickerResultPage.tsx, not here. Sticky only travels within its own
             parent's box, and this element's parent IS that wrapper -- which is
             only as tall as the button, so sticking it here gave it nowhere to
             go. See the note there. */
          .screenerMobileBar { display: block; }
          .screenerPillWrap { display: inline-flex; flex: 0 0 auto; }
        }
        @media (max-width: 420px) {
          .screenerSelectBtn { font-size: 14px; padding: 12px 14px; gap: 10px; }
          .screenerSelectCurrent { font-size: 12px; }
          .screenerPillBtn { font-size: 12px; padding: 8px 13px; max-width: 56vw; }
          /* Two targets share this row on a phone, so give them a little more
             vertical room to land in. */
          .screenerNavCheckable { padding-top: 11px; padding-bottom: 11px; }
        }
      `}</style>
    </>
  );
}
