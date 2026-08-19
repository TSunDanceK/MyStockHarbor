"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Fixed bottom navigation, phones only.
//
// Most arrivals here land from search on a deep page -- a /stock/[symbol], an
// insight, one of the condition screeners -- and until now the only way onward
// from those was the hamburger. A visible bar turns a one-page visit into a
// second page view without the visitor having to go looking for a menu.
//
// It is NOT an SEO measure and should not be justified as one: CrawlableNav
// already emits the full link set into every page's server-rendered HTML (PR
// #257), so Googlebot has had these paths all along. This is purely reach for
// a human thumb, which is also why it sits at the bottom -- the top strip of a
// 6.7" screen is where one-handed thumbs cannot go without a shuffle.
//
// Five destinations, no "More" drawer. Every one is a real index page that was
// checked against app/**/page.tsx before being listed here -- the same rule
// lib/navSections.ts follows, and the reason /insights/videos is absent from
// that file. A sixth slot would push each target under the comfortable minimum
// width, and the hamburger still reaches everything this omits.
const ITEMS: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/",
    label: "Home",
    icon: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" />,
  },
  {
    href: "/pickers",
    label: "Screeners",
    icon: <path d="M3.5 5h17l-6.5 7.5V20l-4-2.5v-5z" />,
  },
  {
    href: "/stock-screener",
    label: "Stocks",
    icon: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.5 15.5 21 21" />
      </>
    ),
  },
  {
    href: "/insights",
    label: "Insights",
    icon: <path d="M4 19V9M9.5 19V5M15 19v-7M20.5 19v-4" />,
  },
  {
    href: "/earnings-calendar",
    label: "Earnings",
    icon: (
      <>
        <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
        <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
      </>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <>
      <nav className="bottomNav" aria-label="Primary">
        {ITEMS.map((item) => {
          // Home is an exact match on purpose. A startsWith test would light it
          // up on every route on the site, since every path begins with "/".
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              // prefetch={false} throughout, matching CrawlableNav. Next
              // prefetches a <Link> on viewport entry, and a bar that is
              // permanently in the viewport would prefetch five expensive
              // dynamic routes on every page of the site -- which is exactly
              // the real-user impact the list-link prefetch work already had
              // to undo once.
              prefetch={false}
              className={active ? "bottomNavItem active" : "bottomNavItem"}
              aria-current={active ? "page" : undefined}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                {item.icon}
              </svg>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <style>{`
        .bottomNav { display: none; }

        @media (max-width: 980px) {
          /* Reserves the bar's own height at the foot of the document so the
             last row of a list, and the footer, are not sitting underneath it.
             Without this the bar is not "fixed", it is "covering something". */
          body { padding-bottom: calc(58px + env(safe-area-inset-bottom)); }

          .bottomNav {
            position: fixed; left: 0; right: 0; bottom: 0;
            /* Below the screener sheet (70) and the site header (100). Being
               under the sheet is deliberate: while it is open, its own Go
               button owns the bottom of the screen. */
            z-index: 55;
            display: flex; align-items: stretch;
            padding-bottom: env(safe-area-inset-bottom);
            border-top: 1px solid rgba(255,255,255,0.10);
            /* Opaque, not translucent. A blurred bar over a dense table of
               numbers reads as smeared rather than as depth. */
            background: #080b12;
          }
          .bottomNavItem {
            flex: 1 1 0; min-width: 0;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 3px; padding: 8px 2px 7px;
            color: rgba(148,163,184,0.85); text-decoration: none;
            font-size: 10.5px; font-weight: 800; letter-spacing: -0.01em;
            white-space: nowrap;
            -webkit-tap-highlight-color: transparent;
          }
          .bottomNavItem span {
            max-width: 100%; overflow: hidden; text-overflow: ellipsis;
          }
          .bottomNavItem:active { background: rgba(255,255,255,0.04); }
          /* The active tab is carried by colour and weight rather than a filled
             icon set, so there is only one set of glyphs to keep in sync. */
          .bottomNavItem.active { color: #93c5fd; font-weight: 950; }
        }

        /* A phone in landscape has very little vertical room; the bar keeps its
           targets but drops the labels to claw back a third of its height. */
        @media (max-width: 980px) and (max-height: 460px) {
          body { padding-bottom: calc(40px + env(safe-area-inset-bottom)); }
          .bottomNavItem { padding: 6px 2px; }
          .bottomNavItem span { display: none; }
        }
      `}</style>
    </>
  );
}
