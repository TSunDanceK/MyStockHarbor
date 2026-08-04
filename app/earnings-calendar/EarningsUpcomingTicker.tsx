import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";

// Scrolling "next up" strip for the top of /earnings-calendar, styled to match
// the dashboard's live feed so the two read as the same component.
//
// Deliberately a SERVER component, unlike DashboardTicker which is a client
// one. DashboardTicker has to be client because it fetches /api/pickers in the
// browser; this has its rows handed to it already, so there is nothing to fetch
// and no state to hold. Two things fall out of that:
//
//   * The marquee is pure CSS, including the reduced-motion opt-out, so no
//     JavaScript ships for it at all. DashboardTicker reads the media query in
//     JS because it is already a client component; here that would be the only
//     reason to become one.
//   * Every ticker and company name is in the server-rendered HTML rather than
//     appearing after hydration, which matters on a page that is meant to be
//     indexed for earnings-date queries.
//
// Rows come from the day caches via getCachedDayItems (read-only, never quotes
// an upstream API), so this adds no external calls -- see the loader in
// page.tsx.

export type UpcomingEarningsItem = {
  symbol: string;
  company: string;
  date: string;
  dayLabel: string;
};

export default function EarningsUpcomingTicker({
  items,
}: {
  items: UpcomingEarningsItem[];
}) {
  if (!items.length) return null;

  // Duplicate the list so translateX(-50%) lands the copy exactly where the
  // original started, which is what makes the loop seamless. Under
  // prefers-reduced-motion the track stops animating and becomes a normal
  // horizontally scrollable row instead -- the duplicate is harmless there,
  // just a longer scroll.
  const trackItems = [...items, ...items];
  const durationSec = Math.max(30, items.length * 4);

  return (
    <div className="earnTicker" aria-label="Upcoming earnings">
      <div className="earnTickerLabel">
        <span className="earnTickerDot" aria-hidden="true" />
        Next up
      </div>

      <div className="earnTickerViewport">
        <div
          className="earnTickerTrack"
          style={{ animationDuration: `${durationSec}s` }}
        >
          {trackItems.map((item, idx) => (
            <Link
              key={`${item.symbol}-${item.date}-${idx}`}
              href={`/stock/${encodeURIComponent(item.symbol)}/earnings`}
              className="earnTickerItem"
              // The duplicated half is decorative: without this a screen reader
              // would read the whole list twice.
              aria-hidden={idx >= items.length ? true : undefined}
              tabIndex={idx >= items.length ? -1 : undefined}
            >
              <TickerLogo symbol={item.symbol} size={18} radius={5} />
              <span className="earnTickerSym">{item.symbol}</span>
              <span className="earnTickerName">{item.company}</span>
              <span className="earnTickerDate">{item.dayLabel}</span>
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        .earnTicker {
          margin: 0 0 24px;
          display: flex;
          align-items: stretch;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.03);
          overflow: hidden;
          height: 40px;
        }
        .earnTickerLabel {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 12px;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #5f6b80;
          border-right: 1px solid rgba(255,255,255,0.08);
          white-space: nowrap;
        }
        .earnTickerDot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #f87171; display: inline-block;
        }
        .earnTickerViewport {
          flex: 1 1 auto;
          overflow: hidden;
          position: relative;
          display: flex;
          align-items: center;
        }
        .earnTickerTrack {
          display: flex;
          align-items: center;
          height: 100%;
          width: max-content;
          animation-name: earnTickerScroll;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .earnTickerTrack:hover { animation-play-state: paused; }
        .earnTickerItem {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 0 18px;
          font-size: 12.5px;
          font-weight: 700;
          color: #c7d0de;
          text-decoration: none;
          white-space: nowrap;
        }
        .earnTickerItem:hover { filter: brightness(1.25); }
        .earnTickerSym { font-weight: 900; color: #e2e8f0; }
        .earnTickerName {
          color: rgba(148,163,184,0.85);
          font-weight: 600;
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .earnTickerDate {
          color: #93c5fd;
          font-weight: 800;
          font-size: 11.5px;
          padding: 2px 7px;
          border-radius: 999px;
          border: 1px solid rgba(96,165,250,0.32);
          background: rgba(59,130,246,0.12);
        }
        @keyframes earnTickerScroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .earnTickerTrack { animation: none; }
          .earnTickerViewport { overflow-x: auto; }
        }
        @media (max-width: 640px) {
          .earnTickerName { display: none; }
          .earnTickerItem { padding: 0 14px; }
        }
      `}</style>
    </div>
  );
}
