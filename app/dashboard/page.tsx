import type { Metadata } from "next";
import { Suspense } from "react";
import DashboardClient from "../components/DashboardClient";

export const metadata: Metadata = {
  title: "Stock Chart Dashboard | MyStockHarbor",
  description:
    "Interactive stock chart dashboard with technical indicators, stock pickers, market benchmarks and news briefings. Analyse any stock with MA, RSI, MACD and more.",
  alternates: {
    canonical: "https://www.mystockharbor.com/dashboard",
  },
  openGraph: {
    title: "Stock Chart Dashboard | MyStockHarbor",
    description:
      "Interactive stock charts with technical indicators, pickers and market benchmarks.",
    url: "https://www.mystockharbor.com/dashboard",
    siteName: "MyStockHarbor",
    type: "website",
  },
};

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 40, fontFamily: "system-ui, Arial" }}>
          Loading dashboard…
        </div>
      }
    >
      <DashboardClient />
    </Suspense>
  );
}
