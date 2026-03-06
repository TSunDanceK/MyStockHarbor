import Link from "next/link";

type PlatformItem = {
  name: string;
  shortLabel: string;
  bestFor: string;
  pros: string[];
  cons: string[];
  note: string;
  affiliateHref: string;
};

const PLATFORMS: PlatformItem[] = [
  {
    name: "TradingView",
    shortLabel: "Best charts-first platform",
    bestFor: "People who want strong charting, clean layouts, and a platform that feels built around analysis first.",
    pros: [
      "Excellent charting and layout tools",
      "Very strong for learning technical analysis",
      "Great if you want charts first and execution second",
    ],
    cons: [
      "More of a charting-first workflow than a simple beginner investing app",
      "Some users may still want a separate broker setup depending on how they trade",
    ],
    note: "Best for traders who care a lot about charts, indicators, and structure.",
    affiliateHref: "#",
  },
  {
    name: "Trading 212",
    shortLabel: "Best beginner-friendly stock app",
    bestFor: "Beginners who want a simple app for stocks and ETFs without too much complexity.",
    pros: [
      "Very easy interface for newer users",
      "Good for simple stock and ETF investing",
      "Feels clean and approachable",
    ],
    cons: [
      "Less advanced-feeling than pro-style platforms",
      "May feel limited later if you want deeper tools",
    ],
    note: "Best for someone starting out who wants simplicity and low friction.",
    affiliateHref: "#",
  },
  {
    name: "eToro",
    shortLabel: "Best social-style investing platform",
    bestFor: "Users who like a simple app experience and want a more social/investor-community feel.",
    pros: [
      "Very beginner-friendly layout",
      "Social-style experience is easy to understand",
      "Useful for users who want an investing app that feels modern and simple",
    ],
    cons: [
      "Not everyone wants the social angle",
      "Serious chart-focused traders may outgrow it",
    ],
    note: "Best for users who want a modern app and a more community-led feel.",
    affiliateHref: "#",
  },
  {
    name: "Interactive Brokers",
    shortLabel: "Best for serious investors",
    bestFor: "Users who want broader market access and a more professional-style platform.",
    pros: [
      "Strong multi-market feel",
      "Better suited to more serious or growing investors",
      "Good if you want a platform you may not outgrow quickly",
    ],
    cons: [
      "Can feel heavier for a complete beginner",
      "Less beginner-friendly than simpler apps",
    ],
    note: "Best for users who want depth and are happy with a more advanced platform.",
    affiliateHref: "#",
  },
  {
    name: "Saxo",
    shortLabel: "Best premium all-round investing experience",
    bestFor: "People who want a polished investing platform that feels more premium and structured.",
    pros: [
      "Clean premium feel",
      "Good fit for longer-term investing and broader platform use",
      "Feels more serious than many beginner apps",
    ],
    cons: [
      "Not the simplest first app for brand-new users",
      "May feel more platform-heavy than ultra-simple alternatives",
    ],
    note: "Best for users who want a polished investing experience rather than the simplest possible app.",
    affiliateHref: "#",
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
    background: "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(59,130,246,0.16))",
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

            <h1 style={{ margin: "6px 0 0", fontSize: 34, letterSpacing: "-0.4px" }}>
              Choosing your Platform
            </h1>

            <div style={{ marginTop: 8, opacity: 0.78, lineHeight: 1.55, maxWidth: 860 }}>
              These are 5 strong platform options depending on whether you care more about charting,
              simplicity, long-term investing, or a more advanced trading setup.
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
            border: "1px solid rgba(168,85,247,0.28)",
            background: "linear-gradient(135deg, rgba(168,85,247,0.14), rgba(59,130,246,0.08))",
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 950, marginBottom: 8 }}>Important before you publish</div>
          <div style={{ opacity: 0.84, lineHeight: 1.55 }}>
            Replace each placeholder affiliate link in this page before publishing. Right now the buttons are ready,
            but the links are set to <strong>#</strong> so you can safely wire in your own partner URLs later.
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
                <div style={{ minWidth: 0, flex: "1 1 560px" }}>
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

                  <h2 style={{ margin: "12px 0 0", fontSize: 28, letterSpacing: "-0.3px" }}>
                    {item.name}
                  </h2>

                  <p style={{ margin: "10px 0 0", opacity: 0.84, lineHeight: 1.6 }}>
                    <strong>Best for:</strong> {item.bestFor}
                  </p>
                </div>

                <a href={item.affiliateHref} style={affiliateBtn()}>
                  View Platform →
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
