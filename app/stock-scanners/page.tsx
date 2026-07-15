import Link from "next/link";
import type { Metadata } from "next";

const PAGE_TITLE = "Stock Scanners Explained | How Traders Screen for Setups | MyStockHarbor";
const PAGE_DESCRIPTION =
  "Learn how traders use stock scanners to narrow the market down to a shortlist of setups worth reviewing - breakouts, oversold conditions, unusual volume and swing-trading indicators.";
const PAGE_URL = "https://www.mystockharbor.com/stock-scanners";
const OG_IMAGE_URL = "https://www.mystockharbor.com/og-image-v2.png";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  robots: { index: true, follow: true },
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: PAGE_URL,
    siteName: "MyStockHarbor",
    images: [
      {
        url: OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: "MyStockHarbor stock scanners guide",
      },
    ],
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [OG_IMAGE_URL],
  },
};

export default function StockScannersPage() {
  return (
    <main
      style={{
        padding: 0,
        fontFamily: "system-ui, Arial",
        background: "#06080d",
        color: "#f1f5f9",
        minHeight: "100vh",
      }}
    >
      <div className="wrap">
        <div style={{ display: "grid", gap: 14 }}>


          <div style={{ maxWidth: 780 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(139,92,246,0.10))",
                border: "1px solid rgba(168,85,247,0.34)",
                color: "#f3e8ff",
                fontWeight: 950,
                letterSpacing: "0.08em",
                fontSize: 12,
              }}
            >
              STOCK SCANNERS
            </div>

            <h1
              style={{
                margin: "14px 0 0 0",
                fontSize: 42,
                lineHeight: 1.08,
                letterSpacing: "-0.6px",
              }}
            >
              Learn how traders scan for stock ideas
            </h1>

            <p
              style={{
                margin: "12px 0 0 0",
                opacity: 0.82,
                lineHeight: 1.65,
                fontSize: 17,
                maxWidth: 760,
              }}
            >
              Stock scanning helps traders narrow down thousands of charts into
              a smaller list worth reviewing. Use this hub to understand how
              traders search for setups, compare screening tools, review
              breakouts and pullbacks, and turn broad market noise into clearer
              stock ideas.
            </p>
          </div>
        </div>

        <section
          style={{
            marginTop: 24,
            borderRadius: 18,
            border: "1px solid rgba(168,85,247,0.24)",
            background:
              "linear-gradient(135deg, rgba(20,12,34,0.92), rgba(13,13,28,0.88))",
            padding: 20,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            maxWidth: 980,
          }}
        >
          <div style={{ fontWeight: 950, fontSize: 24 }}>
            How traders use stock scanners
          </div>

          <div
            style={{
              marginTop: 8,
              opacity: 0.86,
              lineHeight: 1.65,
              maxWidth: 860,
            }}
          >
            Traders do not usually scan for random stocks. They scan for
            specific characteristics such as momentum, oversold conditions,
            breakouts, unusual volume or trend strength. The goal is to reduce
            the market into a shortlist of charts that deserve deeper analysis.
          </div>
        </section>

        <div
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
            maxWidth: 980,
          }}
        >
          <ScannerCard
            href="/how-to-scan-stocks"
            title="How to Scan Stocks"
            desc="Learn the basic process traders use to scan the market for ideas."
            tint="purple"
          />

          <ScannerCard
            href="/best-free-stock-screener"
            title="Best Free Stock Screener"
            desc="See what traders usually want from stock scanning tools."
            tint="blue"
          />

          <ScannerCard
            href="/stock-screener-for-breakouts"
            title="Stock Screener for Breakouts"
            desc="Learn how traders scan for stocks approaching breakout levels."
            tint="red"
          />

          <ScannerCard
            href="/stock-screener-for-oversold-stocks"
            title="Stock Screener for Oversold Stocks"
            desc="Understand how traders search for oversold and rebound candidates."
            tint="green"
          />

          <ScannerCard
            href="/best-indicators-for-swing-trading"
            title="Best Indicators for Swing Trading"
            desc="Explore common indicators traders use when reviewing swing setups."
            tint="amber"
          />

          <ScannerCard
            href="/best-charting-platforms"
            title="Best Charting Platforms"
            desc="Compare the kinds of charting tools traders use to analyse stocks."
            tint="blue"
          />

          <ScannerCard
            href="/how-to-analyse-stocks"
            title="How to Analyse Stocks"
            desc="Read the broader guide to charts, indicators and stock analysis."
            tint="purple"
          />
        </div>

        <section
          style={{
            marginTop: 24,
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 18,
            padding: 20,
            background:
              "linear-gradient(180deg, rgba(9,13,20,0.92), rgba(7,10,16,0.96))",
            maxWidth: 980,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 26,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
            }}
          >
            What traders often scan for
          </h2>

          <div
            style={{
              marginTop: 12,
              display: "grid",
              gap: 14,
              maxWidth: 860,
              opacity: 0.8,
              lineHeight: 1.7,
            }}
          >
            <p style={{ margin: 0 }}>
              Many traders scan for technical setups rather than company names.
              That can include stocks near breakout levels, oversold stocks that
              may rebound, strong trends that are pulling back, or symbols
              showing unusual volume.
            </p>

            <p style={{ margin: 0 }}>
              A stock scanner is only the first step. Once a list is generated,
              the chart still needs to be reviewed properly. That usually means
              checking price structure, support and resistance, momentum
              readings, and whether the move still makes sense in context.
            </p>

            <p style={{ margin: 0 }}>
              Good scanning is not about finding perfect stocks instantly. It is
              about filtering the market more efficiently so you can spend more
              time analysing stronger candidates.
            </p>
          </div>
        </section>

        <section
          style={{
            marginTop: 24,
            border: "1px solid rgba(34,197,94,0.22)",
            borderRadius: 18,
            padding: 20,
            background:
              "linear-gradient(180deg, rgba(8,20,16,0.96), rgba(7,12,11,0.98))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            maxWidth: 980,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 12px",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.10))",
              border: "1px solid rgba(34,197,94,0.34)",
              color: "#dcfce7",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            NEXT STEP
          </div>

          <h2
            style={{
              margin: "14px 0 0 0",
              fontSize: 26,
              letterSpacing: "-0.4px",
            }}
          >
            Put the scanning ideas into practice
          </h2>

          <p
            style={{
              margin: "10px 0 0 0",
              opacity: 0.82,
              lineHeight: 1.6,
              maxWidth: 860,
            }}
          >
            Once you understand how traders scan for ideas, the next step is to
            test those ideas on real charts. Use Stock Pickers to browse
            screened setups or open the Dashboard to review symbols one by one.
          </p>

          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/pickers"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "11px 15px",
                borderRadius: 12,
                border: "1px solid rgba(59,130,246,0.38)",
                background:
                  "linear-gradient(135deg, rgba(59,130,246,0.20), rgba(37,99,235,0.10))",
                color: "#eff6ff",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Explore Stock Pickers →
            </Link>

            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "11px 15px",
                borderRadius: 12,
                border: "1px solid rgba(250,204,21,0.42)",
                background:
                  "linear-gradient(135deg, rgba(250,204,21,0.22), rgba(202,138,4,0.12))",
                color: "#fefce8",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Open the Dashboard →
            </Link>
          </div>
        </section>
      </div>

      <style>{`
        .wrap {
          max-width: 1000px;
          margin: 0 auto;
          padding: 24px;
        }

        a:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }

        @media (max-width: 760px) {
          .wrap {
            padding: 16px !important;
          }
        }
      `}</style>
    </main>
  );
}

function ScannerCard({
  href,
  title,
  desc,
  tint,
}: {
  href: string;
  title: string;
  desc: string;
  tint: "blue" | "green" | "red" | "amber" | "purple";
}) {
  const styles =
    tint === "blue"
      ? {
          border: "1px solid rgba(59,130,246,0.24)",
          background:
            "linear-gradient(180deg, rgba(10,18,34,0.96), rgba(7,12,24,0.98))",
        }
      : tint === "green"
      ? {
          border: "1px solid rgba(34,197,94,0.24)",
          background:
            "linear-gradient(180deg, rgba(9,18,16,0.96), rgba(7,12,11,0.98))",
        }
      : tint === "red"
      ? {
          border: "1px solid rgba(239,68,68,0.24)",
          background:
            "linear-gradient(180deg, rgba(24,12,12,0.96), rgba(14,7,7,0.98))",
        }
      : tint === "amber"
      ? {
          border: "1px solid rgba(234,179,8,0.24)",
          background:
            "linear-gradient(180deg, rgba(18,16,10,0.96), rgba(12,10,7,0.98))",
        }
      : {
          border: "1px solid rgba(168,85,247,0.24)",
          background:
            "linear-gradient(180deg, rgba(14,11,24,0.96), rgba(9,8,16,0.98))",
        };

  return (
    <Link
      href={href}
      style={{
        ...styles,
        borderRadius: 16,
        padding: 16,
        textDecoration: "none",
        color: "#f1f5f9",
        display: "block",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
        transition:
          "transform 120ms ease, filter 120ms ease, border-color 120ms ease, background 120ms ease",
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 17 }}>{title}</div>

      <div
        style={{
          marginTop: 7,
          fontSize: 13,
          opacity: 0.78,
          lineHeight: 1.55,
        }}
      >
        {desc}
      </div>
    </Link>
  );
}
