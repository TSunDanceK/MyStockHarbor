"use client";

import { useEffect, useState } from "react";
import DashboardClient from "./DashboardClient";
import MobileHomePage from "./MobileHomePage";

// Breakpoint that matches DashboardClient's own mobile threshold
const MOBILE_BREAKPOINT = 768;

export default function HomePageRouter({
  pageToken = "",
  initialIsMobile = false,
}: {
  // Minted server-side in app/page.tsx (a Server Component) and forwarded
  // through this client component down to DashboardClient. This component
  // itself can't mint one -- mintQuoteToken() uses Node's crypto and the
  // server-only QUOTE_TOKEN_SECRET, neither available in a "use client"
  // module. Only the desktop branch below needs it; MobileHomePage never
  // calls /api/quote.
  pageToken?: string;
  // UA-sniffed guess from app/page.tsx, used to seed isMobile below instead
  // of starting at null. Previously this component rendered nothing at all
  // (`if (isMobile === null) return null`) until a mount-time
  // window.innerWidth check ran client-side, which meant the server-
  // rendered HTML for "/" -- and every "/?symbol=X" variant -- had no
  // content at all: no DashboardClient, no MobileHomePage, no <h1>, nothing.
  // Bing's Site Scan flagged this as "H1 tag missing" across dozens of
  // "/?symbol=..." URLs (2026-08-07); the real issue was the blank
  // pre-hydration HTML, not the heading specifically. Seeding from a
  // server-side UA guess means real content (including each branch's own
  // <h1>) ships in the initial response for the common case, while the
  // resize-listener effect below still corrects it client-side if the UA
  // guess was wrong (spoofed UA, borderline tablet width, etc).
  initialIsMobile?: boolean;
}) {
  const [isMobile, setIsMobile] = useState<boolean>(initialIsMobile);

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return isMobile ? <MobileHomePage /> : <DashboardClient pageToken={pageToken} />;
}
