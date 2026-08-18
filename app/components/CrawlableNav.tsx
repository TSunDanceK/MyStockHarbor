import Link from "next/link";

import {
  CRAWLABLE_NAV_SECTIONS,
  CRAWLABLE_NAV_LINK_COUNT,
} from "@/lib/navSections";

// ---------------------------------------------------------------------------
// The site's full navigation link set, server-rendered.
//
// Deliberately NOT a client component and deliberately NOT portal-rendered.
// That is the entire point: app/components/SiteHeader.tsx renders every
// dropdown through createPortal and only while open, so ~59 nav links are
// absent from the server-rendered HTML of every page on the site. See
// lib/navSections.ts and claude/header-nav-not-crawlable-2026-08-17.md.
//
// WHY A <details> RATHER THAN AN EXPANDED FOOTER
//
// app/layout.tsx carries a long comment explaining why the footer was cut from
// 29 links to 14: site-wide footer links are discounted boilerplate, and an
// overcrowded footer is one a visitor scans past. That reasoning still holds
// and this does not walk it back. Collapsed, this adds exactly one row to the
// footer; the 61 links inside it are in the HTML either way, because a
// <details> element renders its children into the markup whether it is open or
// closed. Crawlers read and follow them; a human sees an unchanged footer
// unless they choose to open it.
//
// The alternative -- a visually-hidden <nav> -- would have been tidier still,
// but a block of ~60 links hidden from users and served to crawlers is the
// shape of a hidden-links pattern regardless of intent, and that is not a bet
// worth taking on a finance site whose whole problem is a lack of trust
// signals. This is a real, usable affordance instead.
//
// It also matches the /stocks exception already documented in layout.tsx: the
// value here is not the equity these links pass, it is that every hub sits one
// hop from every page so a crawler reaches it early.
//
// prefetch={false} throughout, and it is load-bearing rather than cautious.
// Next's <Link> prefetches on viewport entry, so expanding this would
// otherwise fire ~61 prefetches at once, most of them at expensive dynamic
// picker routes. This site has already blocked its own visitors once through
// exactly that mechanism -- see claude/list-link-prefetch-disable-2026-07-21.md.
// ---------------------------------------------------------------------------

export default function CrawlableNav() {
  return (
    <nav
      aria-label="All site sections"
      // Emitted into the HTML so the link count is verifiable straight from
      // `curl | grep`, which is how the original defect was found and how any
      // regression here should be caught.
      data-nav-links={CRAWLABLE_NAV_LINK_COUNT}
      style={{
        borderTop: "1px solid rgba(255,255,255,0.08)",
        paddingTop: 12,
      }}
    >
      <details className="site-map-details">
        <summary
          style={{
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            color: "#e2e8f0",
            listStyle: "revert",
          }}
        >
          Browse all sections
        </summary>

        <div
          className="site-map-grid"
          style={{
            display: "grid",
            gap: "16px 40px",
            alignItems: "start",
            paddingTop: 14,
          }}
        >
          {CRAWLABLE_NAV_SECTIONS.map((section) => (
            <div
              key={section.heading}
              style={{ display: "grid", gap: 6, alignContent: "start" }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#e2e8f0",
                }}
              >
                {section.heading}
              </div>

              <div style={{ display: "grid", gap: 4 }}>
                {section.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    prefetch={false}
                    style={{
                      color: "rgba(241,245,249,0.68)",
                      textDecoration: "none",
                      fontSize: 12,
                    }}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
    </nav>
  );
}
