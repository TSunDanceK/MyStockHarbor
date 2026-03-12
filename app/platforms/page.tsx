import Link from "next/link";

type PlatformItem = {
  name: string;
  shortLabel: string;
  logoSrc: string;
  logoAlt: string;
  bestFor: string;
  summary: string;
  pros: string[];
  cons: string[];
  note: string;
  affiliateHref: string;
  ctaText: string;
};

const PLATFORMS: PlatformItem[] = [
  {
    name: "TradingView",
    shortLabel: "Best charting platform",
    logoSrc: "/platforms/tradingview.png",
    logoAlt: "TradingView logo",
    bestFor:
      "Beginners and experienced traders who want the best charts, indicators, layout tools, and a cleaner way to analyse stocks.",
    summary:
      "TradingView is the platform most people should use for charting. It is excellent for technical analysis, learning patterns, using indicators, and building confidence reading charts. For many users, the best setup is to do all chart analysis on TradingView, then use one of the broker platforms below to actually place stock trades.",
    pros: [
      "Best overall platform here for charting and technical analysis",
      "Excellent for beginners learning indicators, levels, and trend structure",
      "Also strong enough for more advanced traders who want better chart layouts",
      "Clean, modern interface that makes chart reading easier",
      "Works very well as your main analysis platform even if you trade elsewhere",
    ],
    cons: [
      "Many people still use a separate broker for placing the actual trade",
      "It is more chart-focused than a simple beginner investing app",
      "A brand-new investor may still need a broker below for direct stock execution",
    ],
    note:
      "Best overall choice for charts. A very strong setup is: analyse on TradingView, then execute your stock trade using your broker.",
    affiliateHref: "/api/go/tradingview",
    ctaText: "View TradingView",
  },
  {
    name: "Trading 212",
    shortLabel: "Best beginner broker app",
    logoSrc: "/platforms/trading212.png",
    logoAlt: "Trading 212 logo",
    bestFor:
      "Beginners who want a simple, clean platform for buying stocks and ETFs without feeling overwhelmed.",
    summary:
      "Trading 212 is one of the easiest stock platforms to start with. It feels more beginner-friendly than many professional broker platforms and is a good choice for people who want to keep things simple while they learn.",
    pros: [
      "Very beginner-friendly interface",
      "Simple app for buying stocks and ETFs",
      "Easy to understand compared with more advanced broker platforms",
      "Good choice for someone starting small and learning the basics",
    ],
    cons: [
      "More advanced traders may eventually want deeper tools",
      "Charting and analysis tools are not the main strength",
      "Less professional-feeling than more advanced platforms",
    ],
    note:
      "A very good broker for beginners. Many users would chart on TradingView, then place the trade using Trading 212.",
    affiliateHref: "/api/go/trading212",
    ctaText: "View Trading 212",
  },
  {
    name: "eToro",
    shortLabel: "Best social-style platform",
    logoSrc: "/platforms/etoro.png",
    logoAlt: "eToro logo",
    bestFor:
      "People who want a modern investing platform with a simple layout and a more social, app-based feel.",
    summary:
      "eToro is a well-known beginner-friendly platform that feels modern and accessible. It is often better suited to users who like a simple investing experience rather than a chart-heavy professional setup.",
    pros: [
      "Very approachable for newer users",
      "Modern app feel",
      "Easy to navigate compared with more complex broker platforms",
      "Good for people who want a more casual investing experience",
    ],
    cons: [
      "Charting is not the main reason to choose it",
      "More serious chart-focused traders may outgrow it",
      "Not everyone wants the more social-style platform feel",
    ],
    note:
      "Good for users who want a simple and modern investing experience, but less ideal than TradingView for serious chart work.",
    affiliateHref: "/api/go/etoro",
    ctaText: "View eToro",
  },
  {
    name: "Interactive Brokers",
    shortLabel: "Best advanced broker",
    logoSrc: "/platforms/interactive-brokers.png",
    logoAlt: "Interactive Brokers logo",
    bestFor:
      "More serious investors and traders who want a stronger broker platform and room to grow.",
    summary:
      "Interactive Brokers is a stronger choice for users who want a more professional broker setup. It can feel heavier for complete beginners, but it is a platform many people choose when they want more depth and do not want to outgrow their broker quickly.",
    pros: [
      "Better suited to serious investors and growing traders",
      "More professional-feeling than beginner-first apps",
      "A stronger long-term choice for users who want depth",
      "Good if you want a broker you may not need to switch away from later",
    ],
    cons: [
      "Can feel more complex for a complete beginner",
      "Not as easy to pick up as beginner-focused apps",
      "Less friendly for someone who just wants the simplest possible start",
    ],
    note:
      "A strong broker choice for users who are becoming more serious. Many people would still prefer to chart on TradingView first.",
    affiliateHref: "/api/go/interactivebrokers",
    ctaText: "View Interactive Brokers",
  },
  {
    name: "Saxo",
    shortLabel: "Best premium-feel platform",
    logoSrc: "/platforms/saxo.png",
    logoAlt: "Saxo logo",
    bestFor:
      "Users who want a more polished, premium-feeling investing platform and are happy with a more serious setup.",
    summary:
      "Saxo is a polished platform that feels more premium and structured than many beginner-first apps. It is often a better fit for users who want a more complete investing platform rather than the absolute simplest place to start.",
    pros: [
      "Strong premium feel",
      "More polished than many entry-level investing apps",
      "Good for users who want a more serious platform experience",
      "Can suit longer-term investors who want a more established setup",
    ],
    cons: [
      "Not as beginner-simple as Trading 212",
      "May feel heavier than needed for a first investing app",
      "Not the strongest choice here if your main focus is chart learning",
    ],
    note:
      "A good option for users who want a more premium investing experience, though TradingView is still the better place to do chart analysis.",
    affiliateHref: "/api/go/saxo",
    ctaText: "View Saxo",
  },
];

function topBtn(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#f1f5f9",
    textDecoration: "none",
    fontWeight: 850,
    whiteSpace: "nowrap",
  };
}

function affiliateBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "12px 16px",
    borderRadius: 14,
    border: "1px solid rgba(168,85,247,0.45)",
    background:
      "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(59,130,246,0.16))",
    color: "#f8fafc",
    textDecoration: "none",
    fontWeight: 900,
    letterSpacing: "0.2px",
    minHeight: 46,
  };
}

export default function PlatformsPage() {
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
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>
              PLATFORM GUIDE
            </div>

            <h1
              style={{
                margin: "6px 0 0",
                fontSize: 34,
                letterSpacing: "-0.4px",
              }}
            >
              Choosing your Platform
            </h1>

            <div
              style={{
                marginTop: 8,
                opacity: 0.78,
                lineHeight: 1.55,
                maxWidth: 860,
              }}
            >
              The best setup for many people is simple: use{" "}
              <strong>TradingView</strong> for charting and analysis, then
              choose a broker platform below to actually buy and sell stocks.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/" style={topBtn()}>
              ← Dashboard
            </Link>
            <Link href="/learn" style={topBtn()}>
              Learn →
            </Link>
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            borderRadius: 16,
            border: "1px solid rgba(34,197,94,0.28)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 950, marginBottom: 8 }}>
            Best starting idea
          </div>
          <div style={{ opacity: 0.84, lineHeight: 1.55 }}>
            If you are new, a smart setup is to{" "}
            <strong>learn charts on TradingView</strong>, then use a broker like{" "}
            <strong>Trading 212</strong>, <strong>eToro</strong>,{" "}
            <strong>Interactive Brokers</strong>, or <strong>Saxo</strong> to
            place the trade.
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            borderRadius: 16,
            border: "1px solid rgba(168,85,247,0.28)",
            background:
              "linear-gradient(135deg, rgba(168,85,247,0.14), rgba(59,130,246,0.08))",
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 950, marginBottom: 8 }}>
            Affiliate links
          </div>
          <div style={{ opacity: 0.84, lineHeight: 1.55 }}>
            These buttons now route through internal redirect links. Later, you
            can swap the destination URLs in <strong>/app/api/go/[platform]/route.ts</strong>{" "}
            for your real affiliate links without editing this page again.
          </div>
        </div>

        <div style={{ marginTop: 22, display: "grid", gap: 16 }}>
          {PLATFORMS.map((item, idx) => (
            <section
              key={item.name}
              style={{
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 18,
                padding: 18,
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0, flex: "1 1 700px" }}>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 999,
                      background: "rgba(168,85,247,0.14)",
                      border: "1px solid rgba(168,85,247,0.22)",
                      fontSize: 12,
                      fontWeight: 900,
                      letterSpacing: "0.3px",
                    }}
                  >
                    #{idx + 1} • {item.shortLabel}
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      flexWrap: "wrap",
                    }}
                  >
                    <a
                      href={item.affiliateHref}
                      style={{ textDecoration: "none" }}
                      aria-label={`Visit ${item.name}`}
                    >
                      <div
                        style={{
                          width: 68,
                          height: 68,
                          borderRadius: 16,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "#ffffff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 10,
                          overflow: "hidden",
                          flex: "0 0 auto",
                          cursor: "pointer",
                        }}
                      >
                        <img
                          src={item.logoSrc}
                          alt={item.logoAlt}
                          style={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            objectFit: "contain",
                            display: "block",
                          }}
                        />
                      </div>
                    </a>

                    <div style={{ minWidth: 0 }}>
                      <h2
                        style={{
                          margin: 0,
                          fontSize: 28,
                          letterSpacing: "-0.3px",
                        }}
                      >
                        {item.name}
                      </h2>

                      <p
                        style={{
                          margin: "8px 0 0",
                          opacity: 0.84,
                          lineHeight: 1.6,
                        }}
                      >
                        <strong>Best for:</strong> {item.bestFor}
                      </p>
                    </div>
                  </div>

                  <p style={{ margin: "14px 0 0", opacity: 0.84, lineHeight: 1.6 }}>
                    {item.summary}
                  </p>
                </div>

                <a href={item.affiliateHref} style={affiliateBtn()}>
                  {item.ctaText} →
                </a>
              </div>

              <div
                style={{
                  marginTop: 18,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
                className="platformGrid"
              >
                <div
                  style={{
                    borderRadius: 14,
                    border: "1px solid rgba(34,197,94,0.22)",
                    background: "rgba(34,197,94,0.06)",
                    padding: 14,
                  }}
                >
                  <div style={{ fontWeight: 950, marginBottom: 8 }}>Pros</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
                    {item.pros.map((pro) => (
                      <li key={pro} style={{ opacity: 0.88, lineHeight: 1.5 }}>
                        {pro}
                      </li>
                    ))}
                  </ul>
                </div>

                <div
                  style={{
                    borderRadius: 14,
                    border: "1px solid rgba(239,68,68,0.22)",
                    background: "rgba(239,68,68,0.06)",
                    padding: 14,
                  }}
                >
                  <div style={{ fontWeight: 950, marginBottom: 8 }}>Cons</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
                    {item.cons.map((con) => (
                      <li key={con} style={{ opacity: 0.88, lineHeight: 1.5 }}>
                        {con}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div
                style={{
                  marginTop: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  padding: 14,
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Quick take</div>
                <div style={{ opacity: 0.84, lineHeight: 1.55 }}>{item.note}</div>
              </div>
            </section>
          ))}
        </div>
      </div>

      <style>{`
        .wrap { max-width: 1080px; margin: 0 auto; padding: 24px; }

        @media (max-width: 760px) {
          .wrap { padding: 16px !important; }
          .platformGrid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}
