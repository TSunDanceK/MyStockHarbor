import type { RailCreative } from "@/app/components/AffiliateRail";

// Partner banners (owner request, #553, 14-17 Oct). A plain link and image, no
// script or iframe. Add another creative here, not in the page.
//
// THE eTORO BANNERS ARE OUR OWN COPIES, AND THE LINK GOES THROUGH US (owner
// request, 17 Oct). Hotlinked from eToro's banner server, they were hidden by
// ad blockers, which match `med.etoro.com`: the image never loaded and a bare
// "Ad" label was left. Now the image is a file in public/partners/ (the
// original from the partner portal, byte for byte) and the link is
// /api/go/etoro-rail or /api/go/etoro-insight, which redirects to eToro's
// tracking link under the same real-visitor rule as every other partner link
// (app/api/go/[platform]/route.ts). Nothing on the page names eToro's host.
//
// THE RISK WARNING IS PART OF THE IMAGE, so a saved copy goes stale when eToro
// changes its wording or its loss percentage. ETORO_BANNERS_SAVED is the date
// these were saved from the portal: re-save them, update the date and the
// hashes in scripts/check-etoro-banners.mjs, at least every quarter, and
// whenever eToro changes the warning. The check prints a warning when they are
// old.
export const ETORO_BANNERS_SAVED = "2026-10-17";

/** eToro's click-through (tracking) links. Reached only through /api/go, never put on a page. */
export const ETORO_TRACKING = {
  rail: "https://med.etoro.com/B21111_A128935_TClick.aspx",
  insight: "https://med.etoro.com/B21003_A128935_TClick.aspx",
} as const;

// eToro's 160x600, banner B21111: the screener pages' right-hand strip.
export const ETORO_RAIL: RailCreative = {
  href: "/api/go/etoro-rail",
  imgSrc: "/partners/etoro-160x600.jpg",
  width: 160,
  height: 600,
  alt: "eToro: your capital is at risk",
};

// eToro's 300x600, banner B21003: the foot of an insight post's right-hand
// column, under the sector card.
export const ETORO_INSIGHT_RAIL: RailCreative = {
  href: "/api/go/etoro-insight",
  imgSrc: "/partners/etoro-300x600.jpg",
  width: 300,
  height: 600,
  alt: "eToro: your capital is at risk",
};

// TradingView's 160x600 wide skyscraper, with its own 2x file for dense screens.
export const TRADINGVIEW_RAIL: RailCreative = {
  href: "https://www.tradingview.com/chart/?aff_id=164495&utm_source=creative&utm_lang=EN",
  imgSrc: "https://s3.tradingview.com/pub/referrals/creatives/DT/EN/160x600WideSkyscraper.jpg",
  imgSrc2x: "https://s3.tradingview.com/pub/referrals/creatives/DT/EN/320x1200WideSkyscraper.jpg",
  width: 160,
  height: 600,
  alt: "TradingView",
};

/** The rail's stack, top to bottom. */
export const RAIL_CREATIVES: RailCreative[] = [ETORO_RAIL, TRADINGVIEW_RAIL];

// TradingView's 728x90 leaderboard, under the dashboard chart.
export const TRADINGVIEW_LEADERBOARD: RailCreative = {
  href: TRADINGVIEW_RAIL.href,
  imgSrc: "https://s3.tradingview.com/pub/referrals/creatives/DT/EN/728x90Leaderboard.jpg",
  imgSrc2x: "https://s3.tradingview.com/pub/referrals/creatives/DT/EN/1456x180Leaderboard.jpg",
  width: 728,
  height: 90,
  alt: "TradingView",
};

// The notice beside the dashboard leaderboard. Wording follows the programme's terms as the
// owner supplied them: a $15 discount on a NEXT plan, once a first has been bought. Not "£15",
// not "on sign-up". Descriptive, never an instruction.
export const TRADINGVIEW_OFFER = { headline: "$15 off", detail: "a next TradingView plan, once a first is bought, through this link" };
