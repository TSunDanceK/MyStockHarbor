"use client";

import { useEffect, useState } from "react";
import DashboardClient from "./DashboardClient";
import MobileHomePage from "./MobileHomePage";

// Breakpoint that matches DashboardClient's own mobile threshold
const MOBILE_BREAKPOINT = 768;

export default function HomePageRouter({
  pageToken = "",
}: {
  // Minted server-side in app/page.tsx (a Server Component) and forwarded
  // through this client component down to DashboardClient. This component
  // itself can't mint one -- mintQuoteToken() uses Node's crypto and the
  // server-only QUOTE_TOKEN_SECRET, neither available in a "use client"
  // module. Only the desktop branch below needs it; MobileHomePage never
  // calls /api/quote.
  pageToken?: string;
}) {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Avoid flash: render nothing until we know the screen size
  if (isMobile === null) return null;

  return isMobile ? <MobileHomePage /> : <DashboardClient pageToken={pageToken} />;
}
