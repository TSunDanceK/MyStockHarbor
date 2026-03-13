import type { Metadata } from "next";
import { Suspense } from "react";
import DashboardClient from "./components/DashboardClient";

export const metadata: Metadata = {
  title: "MyStockHarbor — Stock Analysis Dashboard for Trend, Momentum, and Market Context",
  description:
    "Analyse any stock quickly using chart indicators, trend signals, stretch signals, and market context. Built to help beginner and intermediate traders understand price action.",
};

export default function Page() {
  return (
    <>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "16px 40px 0",
          fontFamily: "system-ui, Arial",
          color: "rgba(241,245,249,0.72)",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        Educational stock dashboard and market research tools.
      </div>

<Suspense fallback={<div style={{ padding: 40, fontFamily: "system-ui" }}>Loading dashboard…</div>}>
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{
      __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "MyStockHarbor",
        url: "https://www.mystockharbor.com",
        description:
          "Stock analysis dashboard for understanding trend, momentum, stretch, and market context.",
      }),
    }}
  />
  <DashboardClient />
</Suspense>
    </>
  );
}
