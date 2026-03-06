import DashboardClient from "./components/DashboardClient";
import { Suspense } from "react";

export default function Page() {
  return (
    <>
      {/* SEO content for search engines */}
      <section style={{ padding: 40, maxWidth: 900, margin: "0 auto", fontFamily: "system-ui" }}>
        <h1>MyStockHarbor – Free Trading Dashboard</h1>
        <p>
          MyStockHarbor is a simple trading dashboard designed to help traders
          quickly understand market context, technical signals, and risk
          management. Analyze stocks using indicators like RSI, MACD,
          moving averages, VWAP, Bollinger Bands, and more.
        </p>
        <p>
          The platform includes stock pickers, trading utilities,
          educational trading lessons, and a clean charting interface
          designed for beginner and intermediate traders.
        </p>
      </section>

      {/* Dashboard */}
      <Suspense fallback={<div style={{ padding: 40, fontFamily: "system-ui" }}>Loading dashboard…</div>}>
        <DashboardClient />
      </Suspense>
    </>
  );
}
