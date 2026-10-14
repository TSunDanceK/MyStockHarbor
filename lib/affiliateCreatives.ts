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
