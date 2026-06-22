"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AffiliateLink from "../components/AffiliateLink";

type Region = "UK" | "US";

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
  complianceNote: string;
  affiliateHref: string;
  ctaText: string;
  score: string;
  highlight: string;
  recommended?: boolean;
};

const UK_PLATFORMS: PlatformItem[] = [
  {
    name: "TradingView",
    shortLabel: "Best charting platform",
    logoSrc: "/platforms/tradingview.png",
    logoAlt: "TradingView logo",
    bestFor:
      "Beginners and experienced traders who want strong charts, indicators, layout tools, and a cleaner way to analyse stocks.",
    summary:
      "TradingView is the platform most people should use for charting. It is excellent for technical analysis, learning patterns, using indicators, and building confidence reading charts. For many users, the strongest setup is to do chart analysis on TradingView, then use one of the broker platforms below if they decide to invest.",
    pros: [
      "Best overall platform here for charting and technical analysis",
      "Excellent for beginners learning indicators, levels, and trend structure",
      "Also strong enough for more advanced traders who want better chart layouts",
      "Clean, modern interface that makes chart reading easier",
      "Works very well as your main analysis platform even if you trade elsewhere",
    ],
    cons: [
      "Many people still use a separate broker for investing",
      "It is more chart-focused than a simple beginner investing app",
      "A brand-new investor may still need a broker below for direct stock execution",
    ],
    note:
      "Best overall choice for charts. A very strong setup is: analyse on TradingView, then use your chosen broker if you decide to invest.",
    complianceNote:
      "Platform features, pricing, and market access can vary by region. Trading and investing involve risk, and charting tools should be used for research and educational purposes only.",
    affiliateHref: "/api/go/tradingview",
    ctaText: "Visit TradingView",
    score: "9.7/10",
    highlight: "Best overall for charting",
    recommended: true,
  },
{
  name: "eToro",
  shortLabel: "Best simple beginner-friendly broker",
    logoSrc: "/platforms/etoro.png",
    logoAlt: "eToro logo",
bestFor:
  "People who want a simple, beginner-friendly broker with a modern layout and an easy app feel.",
summary:
  "eToro is a well-known beginner-friendly broker that feels modern and accessible. It is a strong option for people who want a simple investing experience, an easy app feel, and a less intimidating route into buying stocks.",
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
      "A strong choice for users who want a simple modern broker. Many users may prefer to analyse on TradingView first, then use eToro if they decide to invest.",
    complianceNote:
      "eToro is a multi-asset platform. Trading and investing involve risk. If you are promoting eToro under an affiliate arrangement, use the provider-approved risk warning text for your region, including the current CFD retail loss percentage where required.",
    affiliateHref: "/api/go/etoro",
    ctaText: "Visit eToro",
    score: "9.0/10",
  highlight: "Best simple beginner broker",
    recommended: true,
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
      "A very good broker for beginners. Many users would chart on TradingView, then use Trading 212 if they choose to invest.",
    complianceNote:
      "Investing involves risk and the value of investments can go down as well as up. Platform availability, products, and tax treatment can vary depending on your country and personal circumstances.",
    affiliateHref: "/api/go/trading212",
    ctaText: "Visit Trading 212",
    score: "9.3/10",
    highlight: "Best for beginners",
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
    complianceNote:
      "Investing and trading involve risk, and more advanced platforms may offer complex products that are not suitable for all users. Always review the provider's official terms, fees, and product risks before opening an account.",
    affiliateHref: "/api/go/interactivebrokers",
    ctaText: "Visit Interactive Brokers",
    score: "9.2/10",
    highlight: "Best for serious traders",
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
    complianceNote:
      "Investing and trading involve risk, and product availability can vary by region. Review the provider's official risk disclosures, fees, and account terms before making any financial decision.",
    affiliateHref: "/api/go/saxo",
    ctaText: "Visit Saxo",
    score: "8.9/10",
    highlight: "Best premium platform feel",
  },
];

const US_PLATFORMS: PlatformItem[] = [
  {
    name: "TradingView",
    shortLabel: "Best charting platform",
    logoSrc: "/platforms/tradingview.png",
    logoAlt: "TradingView logo",
    bestFor:
      "Beginners and experienced traders who want strong charts, indicators, layout tools, and a cleaner way to analyse stocks.",
    summary:
      "TradingView is still the strongest place to analyse stocks, learn technical analysis, and build conviction before placing an investment. For many US users, the best setup is to analyse on TradingView, then open an account with a broker below.",
    pros: [
      "Best overall for charting and technical analysis",
      "Excellent for learning indicators, patterns, and levels",
      "Clean layouts and strong watchlist tools",
      "Useful whether you are a beginner or more advanced",
      "Works well alongside a separate broker account",
    ],
    cons: [
      "Many users still need a broker for direct execution",
      "More analysis-focused than simple investing apps",
      "A complete beginner may still want a broker below for account opening",
    ],
    note:
      "Best overall choice for chart analysis. A strong setup is: analyse on TradingView, then use a broker below if you decide to invest.",
    complianceNote:
      "Platform features, pricing, and market access can vary by region. Trading and investing involve risk.",
    affiliateHref: "/api/go/tradingview",
    ctaText: "Visit TradingView",
    score: "9.7/10",
    highlight: "Best overall for charting",
    recommended: true,
  },
  {
    name: "Webull",
    shortLabel: "Best active beginner broker",
    logoSrc: "/platforms/webull.svg",
    logoAlt: "Webull logo",
    bestFor:
      "US beginners who want a modern broker feel with more active-market features than a basic investing app.",
    summary:
      "Webull is one of the strongest US beginner broker options to place on the page. It has a modern feel, broad brand recognition, and suits users who want to move from learning into active investing.",
    pros: [
      "Strong beginner-to-intermediate bridge",
      "Modern app feel",
      "Popular in the US retail market",
      "Good brand to pursue for future affiliate monetisation",
    ],
    cons: [
      "Can feel a bit more active-trader oriented for some users",
      "Chart learning is still better on TradingView",
      "Not everyone wants a more market-focused interface",
    ],
    note:
      "A strong US broker pick for users ready to move from learning into action.",
    complianceNote:
      "Investing involves risk. Review fees, available assets, and official disclosures before opening an account.",
    affiliateHref: "/api/go/webull",
    ctaText: "Visit Webull",
    score: "9.2/10",
    highlight: "Best US beginner-active broker",
    recommended: true,
  },
  {
    name: "Robinhood",
    shortLabel: "Best simplest US investing app",
    logoSrc: "/platforms/robinhood.svg",
    logoAlt: "Robinhood logo",
    bestFor:
      "US users who want the simplest, most familiar app-first route into investing.",
    summary:
      "Robinhood is one of the most recognisable US investing apps and is well suited to people who want an easy, familiar, mobile-first investing experience.",
    pros: [
      "Very well-known brand",
      "Simple app-first experience",
      "Beginner-friendly feel",
      "Strong monetisation target for future affiliate deals",
    ],
    cons: [
      "Not the best place to learn chart analysis",
      "Some users may want a more professional broker later",
      "Less depth than more serious broker platforms",
    ],
    note:
      "A strong simple US option for users who want the easiest possible starting point.",
    complianceNote:
      "Investing involves risk. Review the provider's official disclosures, fees, and product availability before opening an account.",
    affiliateHref: "/api/go/robinhood",
    ctaText: "Visit Robinhood",
    score: "9.0/10",
    highlight: "Best simple US app",
  },
  {
    name: "Interactive Brokers",
    shortLabel: "Best advanced broker",
    logoSrc: "/platforms/interactive-brokers.png",
    logoAlt: "Interactive Brokers logo",
    bestFor:
      "More serious US investors and traders who want a stronger broker platform and room to grow.",
    summary:
      "Interactive Brokers remains one of the strongest choices for users who want a more professional long-term broker and do not want to outgrow their platform quickly.",
    pros: [
      "Strong professional broker reputation",
      "Good for serious investors",
      "Long-term depth",
      "Good global credibility",
    ],
    cons: [
      "Can feel more complex for complete beginners",
      "Less friendly than simpler app-based brokers",
      "Still not the easiest first step for everyone",
    ],
    note:
      "Best suited to users becoming more serious about investing and trading.",
    complianceNote:
      "Investing and trading involve risk. More advanced platforms may offer complex products not suitable for all users.",
    affiliateHref: "/api/go/interactivebrokers",
    ctaText: "Visit Interactive Brokers",
    score: "9.2/10",
    highlight: "Best for serious traders",
  },

];

function ctaBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "13px 18px",
    borderRadius: 14,
    border: "1px solid rgba(34,197,94,0.45)",
    background:
      "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
    color: "#f8fafc",
    textDecoration: "none",
    fontWeight: 900,
    letterSpacing: "0.2px",
    minHeight: 48,
    boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
    whiteSpace: "nowrap",
  };
}

function smallVisitBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px",
    borderRadius: 8,
    background: "rgba(34,197,94,0.15)",
    border: "1px solid rgba(34,197,94,0.35)",
    color: "#d1fae5",
    textDecoration: "none",
    fontWeight: 800,
    whiteSpace: "nowrap",
  };
}

function platformTheme(type: "green" | "blue" | "purple" | "yellow" | "red") {
  if (type === "green") {
    return {
      border: "1px solid rgba(34,197,94,0.28)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.06), rgba(255,255,255,0.025))",
      color: "#86efac",
      iconBg: "rgba(34,197,94,0.16)",
      shadow: "0 0 18px rgba(34,197,94,0.14)",
    };
  }

  if (type === "blue") {
    return {
      border: "1px solid rgba(59,130,246,0.30)",
      background: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(168,85,247,0.06), rgba(255,255,255,0.025))",
      color: "#93c5fd",
      iconBg: "rgba(59,130,246,0.16)",
      shadow: "0 0 18px rgba(59,130,246,0.14)",
    };
  }

  if (type === "purple") {
    return {
      border: "1px solid rgba(168,85,247,0.30)",
      background: "linear-gradient(135deg, rgba(168,85,247,0.14), rgba(59,130,246,0.06), rgba(255,255,255,0.025))",
      color: "#c4b5fd",
      iconBg: "rgba(168,85,247,0.16)",
      shadow: "0 0 18px rgba(168,85,247,0.14)",
    };
  }

  if (type === "red") {
    return {
      border: "1px solid rgba(239,68,68,0.28)",
      background: "linear-gradient(135deg, rgba(239,68,68,0.11), rgba(255,255,255,0.025))",
      color: "#fca5a5",
      iconBg: "rgba(239,68,68,0.16)",
      shadow: "0 0 18px rgba(239,68,68,0.14)",
    };
  }

  return {
    border: "1px solid rgba(250,204,21,0.28)",
    background: "linear-gradient(135deg, rgba(250,204,21,0.13), rgba(249,115,22,0.06), rgba(255,255,255,0.025))",
    color: "#fde68a",
    iconBg: "rgba(250,204,21,0.16)",
    shadow: "0 0 18px rgba(250,204,21,0.14)",
  };
}

function platformInfoCardStyle(type: "green" | "blue" | "purple" | "yellow" | "red"): React.CSSProperties {
  const theme = platformTheme(type);

  return {
    borderRadius: 18,
    border: theme.border,
    background: theme.background,
    padding: 16,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)",
  };
}

function platformIconStyle(type: "green" | "blue" | "purple" | "yellow" | "red"): React.CSSProperties {
  const theme = platformTheme(type);

  return {
    width: 42,
    height: 42,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    background: theme.iconBg,
    border: theme.border,
    color: theme.color,
    fontSize: 20,
    boxShadow: theme.shadow,
  };
}

function platformCardTitleStyle(type: "green" | "blue" | "purple" | "yellow" | "red"): React.CSSProperties {
  const theme = platformTheme(type);

  return {
    fontSize: 12,
    fontWeight: 950,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: theme.color,
  };
}

function platformSectionHeaderStyle(type: "green" | "blue" | "purple" | "yellow" | "red"): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 12,
  };
}

export default function PlatformsClient({
  initialRegion,
}: {
  initialRegion: Region;
}) {
  const [region, setRegion] = useState<Region>(initialRegion);

  useEffect(() => {
    const saved = window.localStorage.getItem("msh-platform-region");
    if (saved === "UK" || saved === "US") {
      setRegion(saved);
    }
  }, []);

  function switchRegion(nextRegion: Region) {
    setRegion(nextRegion);
    window.localStorage.setItem("msh-platform-region", nextRegion);
  }

  const platforms = region === "US" ? US_PLATFORMS : UK_PLATFORMS;
  const simpleBrokerName = region === "US" ? "Webull" : "eToro";
  const extraBrokerName = region === "US" ? "Robinhood" : "Trading 212";
  const topBrokerHref = region === "US" ? "/api/go/webull" : "/api/go/etoro";
  const topBrokerName = region === "US" ? "Webull" : "eToro";

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
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>
                PLATFORM GUIDE
              </div>

              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 6,
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                <button
                  onClick={() => switchRegion("UK")}
                  style={{
                    border: "none",
                    cursor: "pointer",
                    padding: "8px 12px",
                    borderRadius: 999,
                    fontWeight: 900,
                    color: region === "UK" ? "#06121f" : "#cbd5e1",
                    background:
                      region === "UK"
                        ? "linear-gradient(135deg, #fde68a, #facc15)"
                        : "transparent",
                  }}
                >
                  UK
                </button>
                <button
                  onClick={() => switchRegion("US")}
                  style={{
                    border: "none",
                    cursor: "pointer",
                    padding: "8px 12px",
                    borderRadius: 999,
                    fontWeight: 900,
                    color: region === "US" ? "#06121f" : "#cbd5e1",
                    background:
                      region === "US"
                        ? "linear-gradient(135deg, #93c5fd, #60a5fa)"
                        : "transparent",
                  }}
                >
                  US
                </button>
              </div>
            </div>

<h1
  className="platformHeroTitle"
  style={{
    margin: "10px 0 0",
    fontSize: 40,
    lineHeight: 1.12,
    letterSpacing: "-0.8px",
    maxWidth: 980,
  }}
>
 Best Trading Platforms {region === "US" ? "US" : "UK"} (2026) – Compare Brokers, Apps & Charting Tools
</h1>

<div
  className="platformHeroText"
  style={{
    marginTop: 14,
    opacity: 0.9,
    lineHeight: 1.7,
    maxWidth: 900,
    fontSize: 19,
  }}
>
  Compare the best trading platforms in the {region === "US" ? "US" : "UK"}.
  <br />
  <strong>Use TradingView</strong> to analyse charts and learn setups.
  <br />
  <strong>Choose {simpleBrokerName}</strong> if you want a simple, beginner-friendly way to start investing.
</div>

            <div
              style={{
                marginTop: 14,
                padding: "14px 16px",
                borderRadius: 16,
                border: "1px solid rgba(34,197,94,0.22)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(59,130,246,0.08))",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
           
<div
  style={{
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    fontSize: 14,
    lineHeight: 1.55,
    color: "#dbeafe",
    maxWidth: 760,
  }}
>
  <div style={platformIconStyle("green")}>✅</div>
  <div>
    <span
      style={{
        fontSize: 16,
        fontWeight: 900,
        letterSpacing: "0.08em",
        color: "#86efac",
      }}
    >
      BEST SIMPLE NEXT STEP:
    </span>{" "}
    open <strong>{topBrokerName}</strong> if you want a simple, beginner-friendly broker, then use{" "}
    <strong>TradingView</strong> alongside it for chart analysis and learning setups.
  </div>
</div>

<AffiliateLink
  href={topBrokerHref}
  eventLabel={`Top Hero CTA ${topBrokerName}`}
  style={ctaBtn()}
>
  Visit {topBrokerName} →
</AffiliateLink>
            </div>
      
          </div>
        </div>

        <div
          className="topCompareGrid platformDesktopOnly"
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 14,
          }}
        >
          <div style={platformInfoCardStyle("green")}>
            <div style={platformSectionHeaderStyle("green")}>
              <div style={platformIconStyle("green")}>📈</div>
              <div>
                <div style={platformCardTitleStyle("green")}>Best for charting</div>
                <div style={{ marginTop: 6, fontSize: 22, fontWeight: 950 }}>
                  TradingView
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.55 }}>
              Best overall if you want to learn technical analysis properly.
            </div>
          </div>

          <div
            style={{
              ...platformInfoCardStyle("blue"),
              minHeight: 176,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={platformSectionHeaderStyle("blue")}>
                <div style={platformIconStyle("blue")}>🧭</div>
                <div>
                  <div style={platformCardTitleStyle("blue")}>Best modern broker feel</div>
                  <div style={{ marginTop: 6, fontSize: 22, fontWeight: 950 }}>
                    {simpleBrokerName}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.55 }}>
                Best if you want a simple, modern broker platform with an easy app feel.
              </div>
            </div>

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "5px 10px",
                borderRadius: 999,
                background: "rgba(250,204,21,0.18)",
                border: "1px solid rgba(250,204,21,0.30)",
                color: "#fde68a",
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: "0.35px",
                alignSelf: "flex-start",
                marginTop: 14,
              }}
            >
              ★ TOP SIMPLE BROKER PICK
            </div>
          </div>

          <div style={platformInfoCardStyle("purple")}>
            <div style={platformSectionHeaderStyle("purple")}>
              <div style={platformIconStyle("purple")}>🌱</div>
              <div>
                <div style={platformCardTitleStyle("purple")}>Best extra beginner option</div>
                <div style={{ marginTop: 6, fontSize: 22, fontWeight: 950 }}>
                  {extraBrokerName}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, opacity: 0.84, lineHeight: 1.55 }}>
              Strong choice if you want a clean beginner-first route to buying stocks.
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            overflowX: "auto",
          }}
        >
<div
  style={{
    padding: "12px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.1)",
  }}
>
  <div
    style={{
      fontWeight: 900,
      fontSize: 14,
      letterSpacing: "0.3px",
    }}
  >
    Compare the best trading platforms {region === "US" ? "US" : "UK"}
  </div>

  <div
    style={{
      marginTop: 6,
      fontSize: 12,
      lineHeight: 1.5,
      opacity: 0.72,
    }}
  >
    Feature scores reflect overall platform tools and depth, not just beginner suitability.
  </div>
</div>

          <table
            className="platformCompareTable platformDesktopOnly"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
              minWidth: 720,
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <th style={{ padding: 12 }}>Platform</th>
                <th style={{ padding: 12 }}>Best For</th>
<th style={{ padding: 12 }}>Feature Score</th>
                <th style={{ padding: 12 }}>Visit</th>
              </tr>
            </thead>

            <tbody>
              {platforms.map((item) => (
                <tr
                  key={item.name}
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <td style={{ padding: 12, fontWeight: 700 }}>{item.name}</td>
                  <td style={{ padding: 12, opacity: 0.8 }}>{item.shortLabel}</td>
                  <td style={{ padding: 12, fontWeight: 900, color: "#86efac" }}>
                    {item.score}
                  </td>
                  <td style={{ padding: 12 }}>
                    <AffiliateLink
                      href={item.affiliateHref}
                      eventLabel={item.name}
                      style={smallVisitBtn()}
                    >
                      Visit →
                    </AffiliateLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="platformCompareMobile">
            {platforms.map((item) => (
              <div
                key={item.name}
                style={{
                  padding: "12px 14px",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto auto",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 900,
                      minWidth: 0,
                    }}
                  >
                    {item.name}
                  </div>

                  <div
                    style={{
                      fontWeight: 900,
                      color: "#86efac",
                      whiteSpace: "nowrap",
                      fontSize: 13,
                    }}
                  >
                    {item.score}
                  </div>

                  <AffiliateLink
                    href={item.affiliateHref}
                    eventLabel={item.name}
                    style={smallVisitBtn()}
                  >
                    Visit →
                  </AffiliateLink>
                </div>

                <div
                  style={{
                    marginTop: 6,
                    opacity: 0.8,
                    lineHeight: 1.45,
                    fontSize: 13,
                  }}
                >
                  <strong>Best for:</strong> {item.shortLabel}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="platformDesktopOnly">
          <div
            style={{
              marginTop: 18,
              borderRadius: 18,
              border: "1px solid rgba(59,130,246,0.22)",
              background: "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(255,255,255,0.035))",
              padding: 18,
            }}
          >
            <div style={platformSectionHeaderStyle("blue")}>
              <div style={platformIconStyle("blue")}>🧠</div>
              <div>
                <div style={platformCardTitleStyle("blue")}>Simple framework</div>
                <div style={{ marginTop: 4, fontWeight: 950, fontSize: 22 }}>
                  How to choose a platform
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ opacity: 0.86, lineHeight: 1.55 }}>
                <strong>If you want the best charts:</strong> use{" "}
                <strong>TradingView</strong> for analysis and chart reading.
              </div>

              <div style={{ opacity: 0.86, lineHeight: 1.55 }}>
                <strong>If you want a simple modern broker:</strong> start with{" "}
                <strong>{simpleBrokerName}</strong> for an easy investing experience.
              </div>

              <div style={{ opacity: 0.86, lineHeight: 1.55 }}>
                <strong>If you want a second beginner option:</strong> choose{" "}
                <strong>{extraBrokerName}</strong> for a clean beginner-friendly route.
              </div>

              <div
                style={{
                  marginTop: 6,
                  paddingTop: 10,
                  borderTop: "1px solid rgba(255,255,255,0.1)",
                  opacity: 0.9,
                  lineHeight: 1.55,
                }}
              >
                <strong>Many users do this:</strong> analyse stocks on{" "}
                <strong>TradingView</strong>, then use a broker like{" "}
                <strong>{simpleBrokerName}</strong> or <strong>{extraBrokerName}</strong>{" "}
                if they decide to invest.
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 22, display: "grid", gap: 16 }}>
          {platforms.map((item, idx) => (
            <section
              key={item.name}
              style={{
                border: item.recommended
                  ? "1px solid rgba(34,197,94,0.24)"
                  : "1px solid rgba(59,130,246,0.16)",
                borderRadius: 20,
                padding: 18,
                background: item.recommended
                  ? "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(59,130,246,0.045), rgba(255,255,255,0.025))"
                  : "linear-gradient(135deg, rgba(59,130,246,0.055), rgba(255,255,255,0.025))",
              }}
            >
              <div
                className="platformTopRow"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "nowrap",
                }}
              >
                <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                  <div
                    className="platformTopPills"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
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
                      className="platformHighlightPill"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "6px 10px",
                        borderRadius: 999,
                        background: "rgba(34,197,94,0.12)",
                        border: "1px solid rgba(34,197,94,0.22)",
                        fontSize: 12,
                        fontWeight: 900,
                      }}
                    >
                      {item.highlight}
                    </div>
                  </div>

                  <div
                    className="platformHeaderBlock"
                    style={{
                      marginTop: 14,
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 14,
                      flexWrap: "nowrap",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                      {item.recommended ? (
                        <div
                          style={{
                            display: "inline-block",
                            marginBottom: 6,
                            padding: "4px 10px",
                            borderRadius: 999,
                            background:
                              "linear-gradient(135deg, rgba(250,204,21,0.25), rgba(249,115,22,0.18))",
                            border: "1px solid rgba(250,204,21,0.35)",
                            fontSize: 11,
                            fontWeight: 900,
                            color: "#fde68a",
                            letterSpacing: "0.4px",
                          }}
                        >
                          ★ RECOMMENDED
                        </div>
                      ) : null}

                      <h2
                        style={{
                          margin: 0,
                          fontSize: 28,
                          letterSpacing: "-0.3px",
                        }}
                      >
                        {item.name}
                      </h2>

                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 22,
                            fontWeight: 900,
                            color: "#86efac",
                          }}
                        >
                          {item.score}
                        </div>

<div
  className="platformScoreLabel"
  style={{ opacity: 0.74, fontSize: 14 }}
>
  MyStockHarbor feature score
</div>
                      </div>

                      <p
                        style={{
                          margin: "10px 0 0",
                          opacity: 0.84,
                          lineHeight: 1.6,
                        }}
                      >
                        <strong>Best for:</strong> {item.bestFor}
                      </p>
                    </div>

                    <AffiliateLink
                      href={item.affiliateHref}
                      eventLabel={item.name}
                      ariaLabel={`Visit ${item.name}`}
                      style={{ textDecoration: "none", flex: "0 0 auto" }}
                    >
                      <div
                        className="platformLogoBox"
                        style={{
                          width: item.name === "TradingView" ? 148 : 76,
                          height: item.name === "TradingView" ? 68 : 76,
                          borderRadius: item.name === "TradingView" ? 18 : 16,
                          border:
                            item.name === "TradingView"
                              ? "1px solid rgba(59,130,246,0.26)"
                              : "1px solid rgba(255,255,255,0.12)",
                          background:
                            item.name === "TradingView"
                              ? "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,245,249,0.96))"
                              : "#ffffff",
                          boxShadow:
                            item.name === "TradingView"
                              ? "0 10px 24px rgba(0,0,0,0.22)"
                              : "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: item.name === "TradingView" ? "10px 16px" : 10,
                          overflow: "hidden",
                          cursor: "pointer",
                        }}
                      >
                        <img
                          src={item.logoSrc}
                          alt={item.logoAlt}
                          style={{
                            width: "100%",
                            height: item.name === "TradingView" ? "auto" : "100%",
                            maxWidth: "100%",
                            maxHeight: "100%",
                            objectFit: "contain",
                            display: "block",
                          }}
                        />
                      </div>
                    </AffiliateLink>
                  </div>

                  <p
                    className="platformSummaryText"
                    style={{
                      margin: "14px 0 0",
                      opacity: 0.84,
                      lineHeight: 1.6,
                    }}
                  >
                    {item.summary}
                  </p>
                </div>

                <div
                  className="platformRightRail"
                  style={{
                    width: 300,
                    minWidth: 300,
                    maxWidth: 300,
                    display: "grid",
                    gap: 12,
                    alignContent: "start",
                    flex: "0 0 300px",
                  }}
                >
                  <AffiliateLink
                    href={item.affiliateHref}
                    eventLabel={item.name}
                    style={ctaBtn()}
                  >
                    {item.ctaText} →
                  </AffiliateLink>

                  {item.name === "Trading 212" || item.name === "Webull" ? (
                    <div
                      style={{
                        fontSize: 13,
                        color: "#86efac",
                        fontWeight: 800,
                        textAlign: "center",
                      }}
                    >
                      Most beginners start here
                    </div>
                  ) : null}

                  <div
                    style={{
                      fontSize: 13,
                      opacity: 0.72,
                      lineHeight: 1.5,
                      textAlign: "center",
                    }}
                  >
                    Visit official platform page
                  </div>

                  {item.name === "TradingView" && (
                    <div
                      className="platformPromoCard"
                      style={{
                        borderRadius: 18,
                        border: "1px solid rgba(59,130,246,0.34)",
                        background:
                          "linear-gradient(135deg, rgba(37,99,235,0.22), rgba(30,41,59,0.22))",
                        padding: 18,
                        boxShadow: "0 12px 28px rgba(0,0,0,0.22)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 34,
                          lineHeight: 1,
                          fontWeight: 950,
                          letterSpacing: "-1px",
                          color: "#dbeafe",
                        }}
                      >
                        $15 OFF
                      </div>

                      <div
                        style={{
                          marginTop: 10,
                          fontSize: 14,
                          lineHeight: 1.55,
                          opacity: 0.88,
                          color: "#e2e8f0",
                        }}
                      >
                        Eligible new users get $15 toward a new TradingView plan
                        when signing up through this page.
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div
                className="platformGrid"
                style={{
                  marginTop: 18,
                  display: "grid",
                  gridTemplateColumns: "1.1fr 1fr 1fr",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    ...platformInfoCardStyle("blue"),
                    padding: 14,
                  }}
                >
                  <div style={platformSectionHeaderStyle("blue")}>
                    <div style={{ ...platformIconStyle("blue"), width: 34, height: 34, fontSize: 16 }}>🔎</div>
                    <div style={platformCardTitleStyle("blue")}>Why choose it</div>
                  </div>
                  <div style={{ marginTop: 10, opacity: 0.84, lineHeight: 1.55 }}>{item.note}</div>
                </div>

                <div
                  style={{
                    ...platformInfoCardStyle("green"),
                    padding: 14,
                  }}
                >
                  <div style={platformSectionHeaderStyle("green")}>
                    <div style={{ ...platformIconStyle("green"), width: 34, height: 34, fontSize: 16 }}>✅</div>
                    <div style={platformCardTitleStyle("green")}>Pros</div>
                  </div>
                  <ul
                    style={{ margin: "10px 0 0", paddingLeft: 18, display: "grid", gap: 8 }}
                  >
                    {item.pros.map((pro) => (
                      <li key={pro} style={{ opacity: 0.88, lineHeight: 1.5 }}>
                        {pro}
                      </li>
                    ))}
                  </ul>
                </div>

                <div
                  style={{
                    ...platformInfoCardStyle("red"),
                    padding: 14,
                  }}
                >
                  <div style={platformSectionHeaderStyle("red")}>
                    <div style={{ ...platformIconStyle("red"), width: 34, height: 34, fontSize: 16 }}>⚠</div>
                    <div style={platformCardTitleStyle("red")}>Cons</div>
                  </div>
                  <ul
                    style={{ margin: "10px 0 0", paddingLeft: 18, display: "grid", gap: 8 }}
                  >
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
                  marginTop: 12,
                  fontSize: 12,
                  lineHeight: 1.55,
                  opacity: 0.62,
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  paddingTop: 10,
                }}
              >
                {item.complianceNote}
              </div>
            </section>
          ))}
        </div>
      </div>

      <style>{`
        .wrap {
          max-width: 1080px;
          margin: 0 auto;
          padding: 24px;
        }

        .msh-site-nav {
          position: sticky;
          top: 0;
          z-index: 30;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 24px;
          background: rgba(10,15,26,0.90);
          backdrop-filter: blur(14px);
          border-bottom: 1px solid #1a2336;
        }

        .msh-site-nav-logo {
          display: flex;
          align-items: center;
          margin-right: 4px;
          text-decoration: none;
          flex: 0 0 auto;
        }

        .msh-site-nav-logo img {
          height: 38px;
          width: auto;
          display: block;
        }

        .msh-site-navlinks {
          display: flex;
          align-items: center;
          gap: 2px;
          margin-left: auto;
          min-width: 0;
        }

        .msh-site-navlink {
          color: #8a97ad;
          font-size: 13.5px;
          font-weight: 600;
          text-decoration: none;
          padding: 7px 12px;
          border-radius: 8px;
          transition: color .15s, background .15s, transform .15s, filter .15s;
          white-space: nowrap;
        }

        .msh-site-navlink:hover {
          color: #eaf0fa;
          background: #141b2b;
        }

        .msh-site-navlink.active {
          color: #eaf0fa;
          background: #141b2b;
          border: 1px solid #222c40;
        }

        a:hover {
          filter: brightness(1.05);
          transform: translateY(-1px);
        }

        .platformMobileOnly {
          display: none;
        }

        .platformCompareMobile {
          display: none;
        }

        @media (max-width: 900px) {
          .topCompareGrid {
            grid-template-columns: 1fr !important;
          }

          .platformGrid {
            grid-template-columns: 1fr !important;
          }

          .platformTopRow {
            flex-wrap: wrap !important;
          }
        }

        @media (max-width: 760px) {
          .wrap {
            padding: 16px !important;
          }

          .msh-site-nav {
            padding: 10px 12px 8px;
            gap: 8px;
            align-items: stretch;
            flex-direction: column;
          }

          .msh-site-nav-logo {
            align-self: flex-start;
          }

          .msh-site-nav-logo img {
            height: 34px;
          }

          .msh-site-navlinks {
            margin-left: 0;
            overflow-x: auto;
            gap: 4px;
            padding-bottom: 2px;
            scrollbar-width: none;
            -webkit-overflow-scrolling: touch;
          }

          .msh-site-navlinks::-webkit-scrollbar {
            display: none;
          }

          .msh-site-navlink {
            flex: 0 0 auto;
            font-size: 12.5px;
            padding: 8px 10px;
          }

          .platformHeroTitle {
            margin: 6px 0 0 !important;
            font-size: 26px !important;
            line-height: 1.12 !important;
            letter-spacing: -0.5px !important;
            max-width: 100% !important;
          }

          .platformHeroText {
            font-size: 14px !important;
            line-height: 1.55 !important;
          }

          .platformDesktopOnly {
            display: none !important;
          }

          .platformMobileOnly {
            display: block !important;
          }

          .platformCompareMobile {
            display: block !important;
          }

          .platformTopPills {
            display: none !important;
          }

          .platformRightRail {
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
            flex: 1 1 100% !important;
            margin-top: 14px !important;
          }

          .platformHeaderBlock {
            align-items: flex-start !important;
            justify-content: space-between !important;
            gap: 12px !important;
          }

          .platformLogoBox {
            width: 56px !important;
            height: 56px !important;
            border-radius: 12px !important;
            padding: 8px !important;
            flex: 0 0 56px !important;
          }

          .platformScoreLabel {
            display: none !important;
          }

          .platformSummaryText {
            font-size: 14px !important;
            line-height: 1.5 !important;
            margin-top: 12px !important;
          }

          .platformPromoCard {
            padding: 14px !important;
          }

          .platformGrid {
            gap: 10px !important;
            margin-top: 14px !important;
          }

          .platformGrid > div {
            padding: 12px !important;
          }

          .platformGrid ul {
            gap: 6px !important;
            padding-left: 16px !important;
          }

          .platformGrid li {
            line-height: 1.4 !important;
            font-size: 13px !important;
          }
        }
      `}</style>
    </main>
  );
}
