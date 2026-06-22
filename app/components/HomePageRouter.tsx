"use client";

import { useEffect, useState } from "react";
import DashboardClient from "./DashboardClient";
import MobileHomePage from "./MobileHomePage";

// Breakpoint that matches DashboardClient's own mobile threshold
const MOBILE_BREAKPOINT = 768;

export default function HomePageRouter() {
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

  return isMobile ? <MobileHomePage /> : <DashboardClient />;
}
