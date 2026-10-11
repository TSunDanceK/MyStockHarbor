"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";

type AffiliateLinkProps = {
  href: string;
  eventLabel: string;
  children: ReactNode;
  style?: CSSProperties;
  ariaLabel?: string;
};

declare global {
  interface Window {
    gtag?: (
      command: string,
      eventName: string,
      params?: Record<string, unknown>
    ) => void;
  }
}

export default function AffiliateLink({
  href,
  eventLabel,
  children,
  style,
  ariaLabel,
}: AffiliateLinkProps) {
  function handleClick() {
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "affiliate_click", {
        event_category: "affiliate",
        event_label: eventLabel,
      });
    }
  }

  return (
    <a href={href} style={style} aria-label={ariaLabel} onClick={handleClick}>
      {children}
    </a>
  );
}
