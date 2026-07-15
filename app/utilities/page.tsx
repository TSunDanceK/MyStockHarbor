import type { Metadata } from "next";
import Link from "next/link";
import CalculatorsPanel from "./CalculatorsPanel";
import {
  infoSectionStyle,
  sectionEyebrowStyle,
  utilityIconStyle,
  guideCardStyle,
} from "./utilitiesStyles";

export const metadata: Metadata = {
  title: "Trading Risk Tools & Calculators | MyStockHarbor",
  description:
    "Use MyStockHarbor trading calculators to estimate liquidation price, position size, stop loss risk, and risk-reward before entering a trade.",
  alternates: {
    canonical: "https://www.mystockharbor.com/utilities",
  },
  openGraph: {
    title: "Trading Risk Tools & Calculators | MyStockHarbor",
    description:
      "Estimate liquidation price, position size, stop loss risk, and risk-reward with MyStockHarbor trading tools.",
    url: "https://www.mystockharbor.com/utilities",
    siteName: "MyStockHarbor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Trading Risk Tools & Calculators | MyStockHarbor",
    description:
      "Estimate liquidation price, position size, stop loss risk, and risk-reward with MyStockHarbor trading tools.",
  },
};

export default function UtilitiesPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "Trading Risk Tools & Calculators",
            url: "https://www.mystockharbor.com/utilities",
            description:
              "Use trading calculators to estimate position size, stop loss risk, liquidation price, and risk-reward before entering a trade.",
            mainEntity: {
              "@type": "ItemList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  item: {
                    "@type": "SoftwareApplication",
                    name: "Position Size Calculator",
                    applicationCategory: "FinanceApplication",
                  },
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  item: {
                    "@type": "SoftwareApplication",
                    name: "Risk Reward Calculator",
                    applicationCategory: "FinanceApplication",
                  },
                },
                {
                  "@type": "ListItem",
                  position: 3,
                  item: {
                    "@type": "SoftwareApplication",
                    name: "Stop Loss Calculator",
                    applicationCategory: "FinanceApplication",
                  },
                },
                {
                  "@type": "ListItem",
                  position: 4,
                  item: {
                    "@type": "SoftwareApplication",
                    name: "Liquidation Calculator",
                    applicationCategory: "FinanceApplication",
                  },
                },
              ],
            },
            breadcrumb: {
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: "Home",
                  item: "https://www.mystockharbor.com/",
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: "Utilities",
                 item: "https://www.mystockharbor.com/utilities",
                },
              ],
            },
          }),
        }}
      />

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
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>
                TRADING UTILITIES
              </div>

              <h1
                style={{
                  margin: "6px 0 0",
                  fontSize: 34,
                  letterSpacing: "-0.4px",
                }}
              >
                Risk Tools & Calculators
              </h1>

              <div
                style={{
                  marginTop: 8,
                  opacity: 0.78,
                  lineHeight: 1.55,
                  maxWidth: 860,
                }}
              >
                Practical tools to help you manage risk, size positions properly,
                and avoid costly trading mistakes.
              </div>
            </div>
          </div>

          <section style={infoSectionStyle()} className="mobileHideIntroSection">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div style={utilityIconStyle("blue")}>🧮</div>
              <div>
                <div style={sectionEyebrowStyle("blue")}>Trading calculators</div>
                <h2 style={{ margin: "8px 0 0", fontSize: 24, lineHeight: 1.2 }}>
                  Free trading calculators for risk management
                </h2>

                <p
                  style={{
                    margin: "10px 0 0",
                    opacity: 0.84,
                    lineHeight: 1.7,
                    maxWidth: 980,
                  }}
                >
                  These trading calculators are designed to help you manage risk before
                  you enter a position. Use the liquidation calculator to estimate
                  where leverage could become dangerous, and use the position size
                  calculator to work out how many shares fit your stop loss and risk
                  amount.
                </p>

                <p
                  style={{
                    margin: "10px 0 0",
                    opacity: 0.84,
                    lineHeight: 1.7,
                    maxWidth: 980,
                  }}
                >
                  Traders often focus too much on entries and not enough on downside
                  control. These tools help you plan trade size, stop distance and
                  risk-reward more clearly before putting capital at risk.
                </p>
              </div>
            </div>
          </section>

          <CalculatorsPanel />

          <section style={infoSectionStyle()}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={utilityIconStyle("blue")}>📘</div>
              <div>
                <div style={sectionEyebrowStyle("blue")}>Learn next</div>
                <h2 style={{ margin: "6px 0 0", fontSize: 24, lineHeight: 1.2 }}>
                  Related risk management guides
                </h2>
              </div>
            </div>

            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <Link href="/position-sizing-guide" style={guideCardStyle()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  Position Sizing Guide
                </div>
                <div
                  style={{
                    marginTop: 6,
                    opacity: 0.76,
                    lineHeight: 1.55,
                    fontSize: 13,
                  }}
                >
                  Learn how traders calculate the correct trade size based on risk
                  and stop loss distance.
                </div>
              </Link>

              <Link href="/stop-loss-strategy" style={guideCardStyle()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  Stop Loss Strategy
                </div>
                <div
                  style={{
                    marginTop: 6,
                    opacity: 0.76,
                    lineHeight: 1.55,
                    fontSize: 13,
                  }}
                >
                  Understand how stop losses help control downside risk and protect
                  trading capital.
                </div>
              </Link>

              <Link href="/trading-risk-management" style={guideCardStyle()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  Trading Risk Management
                </div>
                <div
                  style={{
                    marginTop: 6,
                    opacity: 0.76,
                    lineHeight: 1.55,
                    fontSize: 13,
                  }}
                >
                  Explore the core principles traders use to control losses and
                  manage overall portfolio risk.
                </div>
              </Link>

              <Link href="/risk-reward-ratio" style={guideCardStyle()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  Risk Reward Ratio
                </div>
                <div
                  style={{
                    marginTop: 6,
                    opacity: 0.76,
                    lineHeight: 1.55,
                    fontSize: 13,
                  }}
                >
                  Learn how traders compare potential upside and downside before
                  entering a trade.
                </div>
              </Link>

              <Link href="/margin-trading-explained" style={guideCardStyle()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  Margin Trading Explained
                </div>
                <div
                  style={{
                    marginTop: 6,
                    opacity: 0.76,
                    lineHeight: 1.55,
                    fontSize: 13,
                  }}
                >
                  Understand how leverage works and why liquidation risk matters
                  when trading on margin.
                </div>
              </Link>

              <Link href="/pickers" style={guideCardStyle()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  Find Stock Ideas
                </div>
                <div
                  style={{
                    marginTop: 6,
                    opacity: 0.76,
                    lineHeight: 1.55,
                    fontSize: 13,
                  }}
                >
                  Use the stock pickers to find setups, then return here to plan
                  trade size and risk.
                </div>
              </Link>
            </div>
          </section>

          <section style={infoSectionStyle()}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={utilityIconStyle("yellow")}>❓</div>
              <div>
                <div style={sectionEyebrowStyle("yellow")}>Quick answers</div>
                <h2 style={{ margin: "6px 0 0", fontSize: 24, lineHeight: 1.2 }}>FAQ</h2>
              </div>
            </div>

            <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17 }}>
                  What is a liquidation calculator?
                </h3>
                <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                  A liquidation calculator estimates the price where a leveraged
                  position may be forcibly closed if price moves too far against
                  you.
                </p>
              </div>

              <div>
                <h3 style={{ margin: 0, fontSize: 17 }}>
                  What is a position size calculator?
                </h3>
                <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                  A position size calculator helps you work out how many shares to
                  buy based on your entry, stop loss and maximum acceptable dollar
                  risk.
                </p>
              </div>

              <div>
                <h3 style={{ margin: 0, fontSize: 17 }}>
                  Why does risk-reward matter?
                </h3>
                <p style={{ margin: "8px 0 0", lineHeight: 1.7, opacity: 0.82 }}>
                  Risk-reward helps traders compare the possible upside of a trade
                  with the downside they are accepting. It is one of the basic
                  ways to judge whether a setup is worth taking.
                </p>
              </div>
            </div>
          </section>
        </div>

        <style>{`
          .wrap {
            max-width: 1180px;
            margin: 0 auto;
            padding: 24px;
          }

          .grid2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
          }

          .calcFieldGrid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }

          .calcResultGrid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }

          a:hover {
            filter: brightness(1.05);
            transform: translateY(-1px);
          }

          @media (max-width: 900px) {
            .grid2 {
              grid-template-columns: 1fr !important;
            }
          }

          @media (max-width: 760px) {
            .wrap {
              padding: 16px !important;
            }

            .mobileHideIntroSection {
              display: none !important;
            }

            .calcFieldGrid,
            .calcResultGrid {
              grid-template-columns: 1fr 1fr !important;
              gap: 10px !important;
            }

            .mobileCompactResultCard {
              padding: 12px !important;
              border-radius: 12px !important;
              min-width: 0 !important;
            }

            .mobileCompactResultLabel {
              font-size: 11px !important;
              gap: 2px !important;
              line-height: 1.2 !important;
              flex-wrap: nowrap !important;
              min-width: 0 !important;
            }

            .mobileCompactResultText {
              min-width: 0 !important;
              overflow: hidden !important;
              text-overflow: ellipsis !important;
              white-space: nowrap !important;
            }

            .mobileCompactResultValue {
              font-size: 18px !important;
              line-height: 1.15 !important;
              margin-top: 5px !important;
            }
          }
        `}</style>
      </main>
    </>
  );
}
