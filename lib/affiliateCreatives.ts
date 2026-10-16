import type { RailCreative } from "@/app/components/AffiliateRail";

// Partner banners for the right-hand rail (owner request, #553, 14 Oct). A
// plain link and image, no script or iframe. Add another creative here, not in
// the page.
export const ETORO_RAIL: RailCreative = {
  href: "https://med.etoro.com/B21111_A128935_TClick.aspx",
  imgSrc: "https://med.etoro.com/B21111_A128935_TGet.aspx",
  width: 160,
  height: 600,
  alt: "eToro",
};

// eToro's 300x600 for the foot of an insight post's right-hand column (owner
// request, #553, 16 Oct): the banner the owner supplied from the partner portal,
// a different banner id (B21003) from the screener rail's. A plain link and image.
export const ETORO_INSIGHT_RAIL: RailCreative = {
  href: "https://med.etoro.com/B21003_A128935_TClick.aspx",
  imgSrc: "https://med.etoro.com/B21003_A128935_TGet.aspx",
  width: 300,
  height: 600,
  alt: "eToro",
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
