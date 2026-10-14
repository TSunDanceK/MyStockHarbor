// THE SITE HEADER, RENDERED ON THE SERVER (#552 COWORK #231).
//
// The bar, its styles and the logo are static, so they are server-rendered:
// on every page that is HTML, not JavaScript. The nav tree is data
// (lib/navSections.ts HEADER_NAV), handed to the one client island,
// SiteHeaderNav, which owns everything that needs the browser: the active
// state, the dropdown and flyout menus, the mobile overlay, the stock links
// resolved from the last symbol, and the filed-earnings condition. The island
// renders the menu button, this logo, the nav row and the overlay in the
// bar's own order, so the markup matches the single client component it
// replaces (no visual change; preview screenshots on #552).
import Link from "next/link";

import SiteHeaderNav from "@/app/components/SiteHeaderNav";
import { HEADER_NAV } from "@/lib/navSections";

export default function SiteHeader({
  latestVideoId,
}: {
  // The newest YouTube video, resolved in app/layout.tsx (cached hourly, see
  // lib/youtube.ts); null when the lookup is unavailable, and "Video
  // Breakdowns" then falls back to /insights.
  latestVideoId: string | null;
}) {
  return (
    <header
      className="mshGlobalHeader"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "rgba(10,15,26,0.94)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid #1a2336",
      }}
    >
      <style>{`
        .mshGlobalHeaderNav::-webkit-scrollbar { display: none; }

        /* Base Link Styles */
        .mshGlobalHeaderLink {
          color: #8a97ad;
          font-size: 13.5px;
          font-weight: 700;
          text-decoration: none;
          padding: 7px 12px;
          border-radius: 8px;
          transition: color .15s, background .15s, border-color .15s, box-shadow .15s;
          white-space: nowrap;
          border: 1px solid transparent !important;
          background: transparent;
          box-shadow: none !important;
          line-height: 1.2;
          flex: 0 0 auto;
          outline: none !important;
          -webkit-tap-highlight-color: transparent;
        }

        .mshGlobalHeaderDropdownTrigger {
          font-family: inherit;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
        }

        /* Subtle dark-theme scrollbar for long dropdown/flyout menus
           (e.g. the Pickers dropdown and its Chart/Indicator/Signals
           flyout submenus). */
        .mshGlobalHeaderDropdownMenu {
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.18) transparent;
        }

        .mshGlobalHeaderDropdownMenu::-webkit-scrollbar {
          width: 7px;
        }

        .mshGlobalHeaderDropdownMenu::-webkit-scrollbar-track {
          background: transparent;
        }

        .mshGlobalHeaderDropdownMenu::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.16);
          border-radius: 999px;
        }

        .mshGlobalHeaderDropdownMenu::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.28);
        }

        .mshGlobalHeaderDropdownItem {
          display: block;
          color: #b7c1d1;
          font-size: 13.5px;
          font-weight: 600;
          text-decoration: none;
          padding: 8px 10px;
          border-radius: 7px;
          white-space: nowrap;
          transition: color .15s, background .15s;
          cursor: pointer;
        }

        .mshGlobalHeaderDropdownItem:hover {
          color: #eaf0fa;
          background: #141b2b;
        }

        /* A dropdown row that opens a flyout submenu instead of navigating
           directly -- same base look as a link item, plus a right-facing
           arrow (added inline) to hint that it expands sideways. */
        .mshGlobalHeaderDropdownItem--submenu {
          user-select: none;
        }

        /* "Home" link for a dropdown section (e.g. "Advanced Pickers Page") --
           slightly bolder/brighter than the grouped items below it. */
        .mshGlobalHeaderDropdownItem--emphasis {
          font-weight: 800;
          color: #eaf0fa;
        }

        /* Small uppercase, muted section label -- same visual language as
           the "Screened Results" / "FAQ" section headers on the pickers
           page (app/pickers/page.tsx). */
        .mshGlobalHeaderDropdownHeading {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(148,163,184,0.65);
          padding: 10px 10px 4px;
        }

        .mshGlobalHeaderDropdownSection {
          margin-top: 2px;
          padding-top: 4px;
          border-top: 1px solid rgba(255,255,255,0.06);
        }

        /* Active Path Styles */
        .mshGlobalHeaderLink.is-active {
          color: #eaf0fa !important;
          background: #141b2b !important;
          border-color: #222c40 !important;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.02) inset !important;
        }

        /* Hover Effect (Optional, for better UX) */
        .mshGlobalHeaderLink:hover:not(.is-active) {
          color: #eaf0fa;
        }

        /* Aggressively Strip Focus Rings on Inactive Elements */
        .mshGlobalHeaderLink:not(.is-active):focus,
        .mshGlobalHeaderLink:not(.is-active):active,
        .mshGlobalHeaderLink:not(.is-active):focus-visible {
          outline: none !important;
          box-shadow: none !important;
          border-color: transparent !important;
          background: transparent !important;
        }

        /* Hamburger trigger for the mobile nav overlay -- hidden by
           default (desktop keeps the horizontal link row), shown only
           below the 720px breakpoint. Same dark-panel look as the
           header's own link buttons, with teal bars instead of a plain
           icon so it matches the site's palette rather than a generic
           stock icon. */
        .mshMobileMenuButton {
          display: none;
          width: 40px;
          height: 40px;
          flex: 0 0 auto;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
          padding: 0;
          border-radius: 10px;
          border: 1px solid #222c40;
          background: #141b2b;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .mshMobileMenuButton:hover,
        .mshMobileMenuButton:active {
          background: #1b2436;
          border-color: #2a3550;
        }

        .mshMobileMenuBar {
          display: block;
          width: 20px;
          height: 2.5px;
          border-radius: 999px;
          background: #6FE0D0;
        }

        /* Full-screen mobile nav overlay */
        .mshMobileOverlay {
          position: fixed;
          inset: 0;
          z-index: 500;
          background: #0b1220;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.18) transparent;
        }

        .mshMobileOverlayHeader {
          position: sticky;
          top: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          background: #0b1220;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          z-index: 1;
        }

        .mshMobileOverlayTitle {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(148,163,184,0.75);
        }

        .mshMobileOverlayClose {
          width: 38px;
          height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          border: 1px solid #222c40;
          background: #141b2b;
          color: #eaf0fa;
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .mshMobileOverlayClose:hover,
        .mshMobileOverlayClose:active {
          background: #1b2436;
          border-color: #2a3550;
        }

        .mshMobileOverlayNav {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 8px 10px 28px;
        }

        .mshMobileOverlayLink {
          display: block;
          padding: 14px 12px;
          border-radius: 10px;
          color: #d7deea;
          font-size: 15.5px;
          font-weight: 700;
          text-decoration: none;
        }

        .mshMobileOverlayLink:hover,
        .mshMobileOverlayLink:active {
          color: #eaf0fa;
          background: #141b2b;
        }

        .mshMobileOverlayLink.is-active {
          color: #eaf0fa;
          background: #141b2b;
          box-shadow: inset 0 0 0 1px #222c40;
        }

        .mshMobileOverlayLink--emphasis {
          font-weight: 800;
        }

        .mshMobileOverlayLink--nested {
          padding-left: 26px;
          font-size: 14.5px;
          font-weight: 600;
          color: #b7c1d1;
        }

        .mshMobileOverlayLink--nested2 {
          padding-left: 42px;
          font-size: 14px;
          font-weight: 600;
          color: #9aa7bb;
        }

        .mshMobileOverlayGroup {
          display: flex;
          flex-direction: column;
        }

        .mshMobileOverlayGroupTrigger {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 14px 12px;
          border: none;
          border-radius: 10px;
          background: transparent;
          color: #d7deea;
          font-size: 15.5px;
          font-weight: 700;
          font-family: inherit;
          text-align: left;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .mshMobileOverlayGroupTrigger:hover,
        .mshMobileOverlayGroupTrigger:active,
        .mshMobileOverlayGroupTrigger.is-active {
          color: #eaf0fa;
          background: #141b2b;
        }

        .mshMobileOverlayGroupTrigger--nested {
          padding-left: 26px;
          font-size: 14.5px;
          font-weight: 600;
          color: #b7c1d1;
        }

        .mshMobileOverlayChevron {
          font-size: 9px;
          opacity: 0.7;
          flex: 0 0 auto;
          transition: transform .15s;
        }

        .mshMobileOverlaySubgroup {
          display: flex;
          flex-direction: column;
        }

        /* ---- Drill-down mobile nav (iOS-style slide panels) ---- */
        .mshDrillTitle {
          padding: 4px 18px 12px;
          font-size: 27px;
          font-weight: 950;
          letter-spacing: -0.02em;
          color: #f8fafc;
        }

        .mshDrillPanel {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 6px 12px 32px;
        }

        .mshDrillPanel--fwd { animation: mshDrillInFwd 0.19s ease; }
        .mshDrillPanel--back { animation: mshDrillInBack 0.19s ease; }

        @keyframes mshDrillInFwd {
          from { transform: translateX(26px); opacity: 0; }
          to { transform: none; opacity: 1; }
        }
        @keyframes mshDrillInBack {
          from { transform: translateX(-26px); opacity: 0; }
          to { transform: none; opacity: 1; }
        }

        /* A leaf row = an actual page link. */
        .mshDrillLink {
          display: block;
          padding: 15px 14px;
          border-radius: 12px;
          color: #d7deea;
          font-size: 16px;
          font-weight: 700;
          text-decoration: none;
        }
        .mshDrillLink:hover,
        .mshDrillLink:active {
          color: #eaf0fa;
          background: #141b2b;
        }
        .mshDrillLink.is-active {
          color: #eaf0fa;
          background: #141b2b;
          box-shadow: inset 0 0 0 1px #222c40;
        }
        .mshDrillLink--emphasis { font-weight: 850; color: #eaf0fa; }

        /* A branch row = opens a deeper panel. Brighter + a right chevron so
           it's obviously "drills in" rather than "navigates". */
        .mshDrillBranch {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          width: 100%;
          padding: 15px 14px;
          border: none;
          border-radius: 12px;
          background: transparent;
          color: #e8eef8;
          font-size: 16px;
          font-weight: 800;
          font-family: inherit;
          text-align: left;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .mshDrillBranch:hover,
        .mshDrillBranch:active,
        .mshDrillBranch.is-active {
          color: #eaf0fa;
          background: #141b2b;
        }
        .mshDrillBranchChevron {
          flex: 0 0 auto;
          font-size: 22px;
          line-height: 1;
          color: #5c6b83;
        }
        .mshDrillBranch.is-active .mshDrillBranchChevron { color: #93c5fd; }

        /* Back button in the overlay header. */
        .mshDrillBack {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 6px 10px 6px 2px;
          border: none;
          background: transparent;
          color: #93c5fd;
          font-size: 15.5px;
          font-weight: 800;
          font-family: inherit;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .mshDrillBack:active { opacity: 0.7; }
        .mshDrillBackChevron { font-size: 24px; line-height: 1; margin-top: -2px; }

        @media (max-width: 720px) {
          .mshGlobalHeaderInner {
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 8px !important;
            min-height: auto !important;
            padding: 10px 14px !important;
          }

          .mshGlobalHeaderLogo {
            align-self: center !important;
          }

          .mshGlobalHeaderLogo img {
            height: 32px !important;
          }

          /* Below this breakpoint the full link row is replaced by the
             hamburger + full-screen overlay -- hide it here instead of
             removing it from the tree, so the >720px layout above is
             completely untouched. */
          .mshGlobalHeaderNav {
            display: none !important;
          }

          .mshMobileMenuButton {
            display: inline-flex !important;
          }
        }
      `}</style>

      <div
        className="mshGlobalHeaderInner"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 18px",
          minHeight: 50,
        }}
      >
        <SiteHeaderNav
          items={HEADER_NAV}
          latestVideoId={latestVideoId}
          logo={
            <Link
              href="/"
              aria-label="MyStockHarbor home"
              className="mshGlobalHeaderLogo"
              style={{
                display: "inline-flex",
                alignItems: "center",
                textDecoration: "none",
                flex: "0 0 auto",
                outline: "none",
              }}
            >
              <img
                src="/logo.png"
                alt="MyStockHarbor"
                style={{
                  height: 38,
                  width: "auto",
                  display: "block",
                  objectFit: "contain",
                }}
              />
            </Link>
          }
        />
      </div>
    </header>
  );
}
