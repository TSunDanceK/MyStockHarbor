// app/learn/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import LearnShell from "./LearnShell";
import LearnMap from "./LearnMap";

export const metadata: Metadata = {
  title: "Learn Stock Charts & Trading Basics",
  description:
    "Beginner lessons on stock charts, indicators, trading basics and risk management.",
  alternates: {
    canonical: "https://www.mystockharbor.com/learn",
  },
  openGraph: {
    title: "Learn Stock Charts & Trading Basics",
    description:
      "Beginner lessons on stock charts, indicators, trading basics and risk management.",
    url: "https://www.mystockharbor.com/learn",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Learn Stock Charts & Trading Basics",
    description:
      "Beginner lessons on stock charts, indicators, trading basics and risk management.",
  },
};


export default function LearnPage() {
  return (
    <LearnShell>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                border: "1px solid rgba(59,130,246,0.34)",
                color: "#dbeafe",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              LEARN
            </div>

<h1 style={{ margin: 0, fontSize: 34, letterSpacing: "-0.4px" }}>
  Learn Stock Charts & Trading Basics
</h1>

<p
  style={{
    margin: "10px 0 0 0",
    opacity: 0.75,
    lineHeight: 1.5,
    maxWidth: 760,
  }}
>
  Beginner-friendly lessons on stock charts, technical indicators, trading
  basics and risk management to help you understand the tools used across
  MyStockHarbor.
</p>
          </div>
        </div>

        <div
          style={{
            marginTop: 22,
            borderRadius: 16,
            border: "1px solid rgba(34,197,94,0.28)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
            padding: 18,
          }}
        >
          <div style={{ fontWeight: 950, marginBottom: 6 }}>New to trading?</div>

          <div style={{ opacity: 0.85, lineHeight: 1.55 }}>
            Before learning indicators and chart patterns, it&apos;s helpful to choose a
            trading platform. Most people analyse charts using <strong>TradingView</strong>{" "}
            and place trades using a broker like Trading 212 or Interactive Brokers.
          </div>

          <div style={{ marginTop: 12 }}>
            <Link
              href="/platforms"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(34,197,94,0.45)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
                color: "#f8fafc",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Choose Your Trading Platform →
            </Link>
          </div>
        </div>

        {/* ============================================================
            EDUCATION — every lesson and guide as one spider map
            (#563 COWORK #166 PR 3, reworked per #169): titles only, each
            one's short description in its hover / tap card, every lesson a
            real link.
            ============================================================ */}
        <div style={{ marginTop: 28, marginBottom: 4 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 950,
              letterSpacing: "0.14em",
              color: "rgba(148,163,184,0.85)",
            }}
          >
            YOUR LEARNING MAP
          </div>
          <div data-fine-print="" style={{ marginTop: 4, fontSize: "var(--fs-fine)", opacity: 0.7, lineHeight: 1.5 }}>
            Start at the hub and follow a branch. Hover or tap a lesson to see what it covers; click, or tap again, to open it.
          </div>
        </div>

        <LearnMap />
    </LearnShell>
  );
}
