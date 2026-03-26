"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

type RegionContent = {
  heroTitle: string;
  heroText: string;
  mobileBlurb: string;
  startHereTitle: string;
  startHereBody: string;
  topCards: { eyebrow: string; title: string; body: string; accent: string; featured?: boolean }[];
  chooser: { title: string; body: string }[];
  platforms: PlatformItem[];
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
    shortLabel: "Best social-style broker app",
    logoSrc: "/platforms/etoro.png",
    logoAlt: "eToro logo",
    bestFor:
      "People who want a modern investing platform with a simple layout and a more social, app-based feel.",
    summary:
      "eToro is a well-known beginner-friendly platform that feels modern and accessible. It is a strong option for people who want a simple broker experience, an easy app feel, and a less intimidating route into investing.",
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
    highlight: "Best simple modern broker",
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
      "People who want the best charts, indicators, layouts, and a cleaner way to analyse US stocks before investing.",
    summary:
      "TradingView is still the best first stop for most users. It gives you a cleaner way to study charts, learn technical analysis, and build conviction before placing a trade with a US broker.",
    pros: [
      "Best overall charting experience on the page",
      "Excellent for learning setups, indicators, and support and resistance",
      "Useful whether you are a complete beginner or already active",
      "Works well as the analysis layer in a two-step funnel",
      "Strong bridge from your pickers into broker action",
    ],
    cons: [
      "You will usually still need a separate broker to place trades",
      "More analysis-focused than execution-focused",
      "A pure beginner investor may still want a simpler broker app alongside it",
    ],
    note:
      "Best overall setup for US users: analyse on TradingView, then open an account with a broker below when you are ready to act.",
    complianceNote:
      "Charting tools are for research and education. Trading and investing involve risk, and platform features can vary by market and account type.",
    affiliateHref: "/api/go/tradingview",
    ctaText: "Visit TradingView",
    score: "9.7/10",
    highlight: "Best overall for charting",
    recommended: true,
  },
  {
    name: "Webull",
    shortLabel: "Best beginner trading app",
    logoSrc: "/platforms/webull.svg",
    logoAlt: "Webull logo",
    bestFor:
      "Beginners who want a modern US broker app with a smoother feel than older broker platforms.",
    summary:
      "Webull is a very strong US broker option for newer users. It feels modern, has broad brand familiarity in the retail trading space, and is one of the cleaner fits for people moving from chart analysis into their first real brokerage account.",
    pros: [
      "Beginner-friendly app feel",
      "Popular brand with active retail traders",
      "Good fit for users moving from research into action",
      "Strong candidate for future affiliate monetisation",
    ],
    cons: [
      "Some beginners may still need guidance choosing between investing and active trading features",
      "Not as simple as the most stripped-back investing apps",
      "Charting is not the main reason to choose it over TradingView",
    ],
    note:
      "One of the best US brokers to feature if you want a clear beginner route from analysis into account signup.",
    complianceNote:
      "Investing and trading involve risk. Review the provider's official disclosures, account terms, fees, and promotion rules before opening an account.",
    affiliateHref: "/api/go/webull",
    ctaText: "Visit Webull",
    score: "9.2/10",
    highlight: "Best US beginner broker",
    recommended: true,
  },
  {
    name: "Robinhood",
    shortLabel: "Best simple US investing app",
    logoSrc: "/platforms/robinhood.svg",
    logoAlt: "Robinhood logo",
    bestFor:
      "People who want the most recognisable, easy-feeling US investing app with low friction.",
    summary:
      "Robinhood is one of the best-known investing apps in the US and can convert well with beginners because the brand is familiar and the signup journey feels simple. It is a strong monetisation candidate once your affiliate setup is in place.",
    pros: [
      "Huge brand recognition",
      "Simple app-first experience",
      "Likely to resonate with beginner traffic",
      "Strong option for a low-friction CTA",
    ],
    cons: [
      "More serious traders may eventually want deeper tools",
      "Not the best destination for chart-first users",
      "Some users will still prefer a more professional-feeling broker",
    ],
    note:
      "Very strong choice if you want a mainstream US broker that feels simple and easy to start with.",
    complianceNote:
      "Investing involves risk, including the risk of loss. Product availability, eligibility, and offers can vary by state, account type, and customer profile.",
    affiliateHref: "/api/go/robinhood",
    ctaText: "Visit Robinhood",
    score: "9.0/10",
    highlight: "Best simple US app",
  },
  {
    name: "Interactive Brokers",
    shortLabel: "Best serious global broker",
    logoSrc: "/platforms/interactive-brokers.png",
    logoAlt: "Interactive Brokers logo",
    bestFor:
      "Users who want a stronger long-term broker and may outgrow simpler beginner apps.",
    summary:
      "Interactive Brokers is ideal for users who want depth, flexibility, and a more serious broker from day one. It also gives you continuity across regions, which makes it a smart bridge between your UK and US platform lists.",
    pros: [
      "Stronger long-term broker choice",
      "Global brand with depth and flexibility",
      "Good fit for more serious investors",
      "Useful crossover platform for UK and US audiences",
    ],
    cons: [
      "Heavier learning curve than simpler apps",
      "Can feel intimidating for complete beginners",
      "Not the most casual option on the page",
    ],
    note:
      "Best for users who want to start with a broker they may never need to outgrow.",
    complianceNote:
      "More advanced platforms can offer products and features that are not suitable for every user. Review the broker's official fees, account options, and risk disclosures before opening an account.",
    affiliateHref: "/api/go/interactivebrokers",
    ctaText: "Visit Interactive Brokers",
    score: "9.1/10",
    highlight: "Best for serious investors",
  },
  {
    name: "Moomoo",
    shortLabel: "Best extra growth broker pick",
    logoSrc: "/platforms/moomoo.svg",
    logoAlt: "Moomoo logo",
    bestFor:
      "Users who want another modern US broker option alongside Webull and Robinhood.",
    summary:
      "Moomoo gives you a useful fourth US option that still feels modern and retail-friendly. It broadens your page, gives you another monetisation target, and avoids over-relying on just one or two names.",
    pros: [
      "Modern app-first feel",
      "Useful extra monetisation slot for the US toggle",
      "Good variety alongside Webull and Robinhood",
      "Can help reduce decision fatigue by segmenting users",
    ],
    cons: [
      "Less mainstream than Robinhood",
      "Some users may not recognise the brand immediately",
      "Still benefits from being paired with TradingView for analysis",
    ],
    note:
      "A good additional US broker to test, especially if you want to compare conversion rates across multiple beginner-friendly names.",
    complianceNote:
      "Investing and trading involve risk. Offers, rewards, and account eligibility can change, so users should review the provider's latest disclosures and terms.",
    affiliateHref: "/api/go/moomoo",
    ctaText: "Visit Moomoo",
    score: "8.8/10",
    highlight: "Best extra US option",
  },
];

const REGION_CONTENT: Record<Region, RegionContent> = {
  UK: {
    heroTitle: "Best Trading Platforms in the UK for Beginners, Chart Analysis, and Serious Traders",
    heroText:
      "Looking for the best trading platform for beginners, better stock chart analysis, or a simple broker to start with in the UK? This guide compares the strongest options for different types of users, with TradingView as the best overall charting platform and beginner-friendly brokers below when you are ready to invest.",
    mobileBlurb:
      "Simple setup: analyse on TradingView, then use a broker like eToro or Trading 212 if you decide to invest.",
    startHereTitle: "Start here",
    startHereBody:
      "Most UK beginners should start by analysing a stock on TradingView, then use a broker like eToro or Trading 212 when they are ready to invest.",
    topCards: [
      {
        eyebrow: "BEST FOR CHARTING",
        title: "TradingView",
        body: "Best overall if you want to learn technical analysis properly.",
        accent: "green",
      },
      {
        eyebrow: "BEST MODERN BROKER FEEL",
        title: "eToro",
        body: "Best if you want a simple, modern broker platform with an easy app feel.",
        accent: "blue",
        featured: true,
      },
      {
        eyebrow: "BEST EXTRA BEGINNER OPTION",
        title: "Trading 212",
        body: "Strong choice if you want a clean beginner-first route to buying stocks.",
        accent: "purple",
      },
    ],
    chooser: [
      { title: "If you want the best charts", body: "Use TradingView for analysis and chart reading." },
      { title: "If you want a simple modern broker", body: "Start with eToro for an easy app-based investing experience." },
      { title: "If you want a second beginner option", body: "Choose Trading 212 for a clean route to buying stocks and ETFs." },
    ],
    platforms: UK_PLATFORMS,
  },
  US: {
    heroTitle: "Best Trading Platforms in the US for Beginners, Chart Analysis, and Long-Term Investors",
    heroText:
      "Looking for the best US trading platform for beginners, stronger chart analysis, or a cleaner broker to start with? This guide is built for US users, with TradingView as the best place to analyse stocks first and beginner-friendly US brokers below when you are ready to open an account.",
    mobileBlurb:
      "Simple setup: find a stock, analyse it on TradingView, then invest using Webull, Robinhood, or Interactive Brokers.",
    startHereTitle: "Most beginners start here",
    startHereBody:
      "Find a stock on MyStockHarbor, analyse it on TradingView, then use Webull or Robinhood when you are ready to invest. More serious users can go straight to Interactive Brokers.",
    topCards: [
      {
        eyebrow: "BEST FOR CHARTING",
        title: "TradingView",
        body: "Best overall if you want to analyse US stocks properly before acting.",
        accent: "green",
      },
      {
        eyebrow: "BEST US BEGINNER BROKER",
        title: "Webull",
        body: "Strong app-first choice for newer users who want a modern broker feel.",
        accent: "blue",
        featured: true,
      },
      {
        eyebrow: "BEST SIMPLE US APP",
        title: "Robinhood",
        body: "Best if you want the most recognisable low-friction investing app.",
        accent: "purple",
      },
    ],
    chooser: [
      { title: "If you want the best charts", body: "Use TradingView before making any broker decision." },
      { title: "If you want the easiest beginner broker", body: "Start with Webull or Robinhood for the lowest-friction route." },
      { title: "If you want something more serious", body: "Choose Interactive Brokers for a stronger long-term setup." },
    ],
    platforms: US_PLATFORMS,
  },
};

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

const topNavIconWrapStyle: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

function topNavBtnStyle(type: "dashboard" | "learn" | "pickers" | "calculators"): React.CSSProperties {
  const styles = {
    dashboard: ["rgba(250,204,21,0.45)", "linear-gradient(135deg, rgba(250,204,21,0.20), rgba(202,138,4,0.10))", "#fefce8"],
    learn: ["rgba(59,130,246,0.45)", "linear-gradient(135deg, rgba(59,130,246,0.20), rgba(37,99,235,0.10))", "#eff6ff"],
    pickers: ["rgba(239,68,68,0.45)", "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.10))", "#fef2f2"],
    calculators: ["rgba(168,85,247,0.45)", "linear-gradient(135deg, rgba(168,85,247,0.20), rgba(139,92,246,0.10))", "#faf5ff"],
  } as const;

  const [border, background, color] = styles[type];

  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 42,
    padding: "9px 13px",
    borderRadius: 14,
    border: `1px solid ${border}`,
    background,
    color,
    textDecoration: "none",
    fontWeight: 900,
    fontSize: 14,
    whiteSpace: "nowrap",
    boxShadow: "0 8px 18px rgba(0,0,0,0.20)",
    transition: "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, filter 120ms ease",
  };
}

function topNavIcon(type: "dashboard" | "learn" | "pickers" | "calculators") {
  if (type === "dashboard") return "📈";
  if (type === "learn") return "📘";
  if (type === "pickers") return "📊";
  return "🧮";
}

function regionPillStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    padding: "9px 14px",
    borderRadius: 999,
    border: active ? "1px solid rgba(34,197,94,0.45)" : "1px solid rgba(255,255,255,0.12)",
    background: active
      ? "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(59,130,246,0.14))"
      : "rgba(255,255,255,0.04)",
    color: active ? "#f0fdf4" : "#cbd5e1",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: active ? "0 8px 18px rgba(0,0,0,0.20)" : "none",
  };
}

export default function PlatformsClient({ initialRegion }: { initialRegion: Region }) {
  const [region, setRegion] = useState<Region>(initialRegion);
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("platformRegion");
    if (saved === "UK" || saved === "US") {
      setRegion(saved);
      setDetected(true);
      return;
    }

    setRegion(initialRegion);
    setDetected(true);
    window.localStorage.setItem("platformRegion", initialRegion);
  }, [initialRegion]);

  function updateRegion(next: Region) {
    setRegion(next);
    window.localStorage.setItem("platformRegion", next);
  }

  const content = useMemo(() => REGION_CONTENT[region], [region]);

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
          <div
            className="topNavRow"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <Link href="/" style={topNavBtnStyle("dashboard")}>
                <span aria-hidden="true" style={topNavIconWrapStyle}>{topNavIcon("dashboard")}</span>
                <span className="topNavText">Dashboard</span>
              </Link>
              <Link href="/pickers" style={topNavBtnStyle("pickers")}>
                <span aria-hidden="true" style={topNavIconWrapStyle}>{topNavIcon("pickers")}</span>
                <span className="topNavText"><span className="topNavShowDesktop">Stock Pickers</span><span className="topNavShowMobile">Pickers</span></span>
              </Link>
              <Link href="/learn" style={topNavBtnStyle("learn")} className="topNavIconOnlyMobile">
                <span aria-hidden="true" style={topNavIconWrapStyle}>{topNavIcon("learn")}</span>
                <span className="topNavText topNavHideOnMobile">Learn</span>
              </Link>
              <Link href="/utilities" style={topNavBtnStyle("calculators")} className="topNavIconOnlyMobile">
                <span aria-hidden="true" style={topNavIconWrapStyle}>{topNavIcon("calculators")}</span>
                <span className="topNavText topNavHideOnMobile">Calculators</span>
              </Link>
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
              <button type="button" onClick={() => updateRegion("UK")} style={regionPillStyle(region === "UK")}>🇬🇧 UK</button>
              <button type="button" onClick={() => updateRegion("US")} style={regionPillStyle(region === "US")}>🇺🇸 US</button>
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>PLATFORM GUIDE</div>
              {detected ? (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                    background: "rgba(59,130,246,0.10)",
                    border: "1px solid rgba(59,130,246,0.22)",
                    color: "#bfdbfe",
                  }}
                >
                  Auto-selected: {region}
                </div>
              ) : null}
            </div>

            <h1 className="platformHeroTitle">{content.heroTitle}</h1>

            <div className="platformHeroText" style={{ marginTop: 8, opacity: 0.78, lineHeight: 1.55, maxWidth: 880 }}>
              {content.heroText}
            </div>

            <div
              className="platformMobileOnly"
              style={{
                marginTop: 12,
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid rgba(250,204,21,0.20)",
                background: "linear-gradient(135deg, rgba(250,204,21,0.08), rgba(15,23,42,0.10))",
                lineHeight: 1.55,
                opacity: 0.88,
              }}
            >
              <strong>{content.startHereTitle}:</strong> {content.mobileBlurb}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 18,
            borderRadius: 18,
            border: "1px solid rgba(250,204,21,0.22)",
            background: "linear-gradient(135deg, rgba(250,204,21,0.10), rgba(15,23,42,0.12))",
            padding: 18,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.8, letterSpacing: "0.4px" }}>{content.startHereTitle.toUpperCase()}</div>
          <div style={{ marginTop: 8, fontSize: 18, fontWeight: 900, lineHeight: 1.35 }}>{content.startHereBody}</div>
        </div>

        <div className="topCompareGrid platformDesktopOnly" style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
          {content.topCards.map((card) => {
            const accent =
              card.accent === "green"
                ? ["rgba(34,197,94,0.28)", "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))"]
                : card.accent === "blue"
                ? ["rgba(59,130,246,0.28)", "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(168,85,247,0.08))"]
                : ["rgba(168,85,247,0.28)", "linear-gradient(135deg, rgba(168,85,247,0.14), rgba(59,130,246,0.08))"];

            return (
              <div key={card.title} style={{ borderRadius: 16, border: `1px solid ${accent[0]}`, background: accent[1], padding: 16, position: "relative", overflow: "hidden" }}>
                {card.featured ? (
                  <div style={{ display: "inline-flex", alignItems: "center", padding: "5px 10px", borderRadius: 999, background: "rgba(250,204,21,0.18)", border: "1px solid rgba(250,204,21,0.30)", color: "#fde68a", fontSize: 11, fontWeight: 900, letterSpacing: "0.35px", marginBottom: 10 }}>
                    ★ TOP CTA PICK
                  </div>
                ) : null}
                <div style={{ fontSize: 12, opacity: 0.78, fontWeight: 900 }}>{card.eyebrow}</div>
                <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{card.title}</div>
                <div style={{ marginTop: 8, opacity: 0.84, lineHeight: 1.55 }}>{card.body}</div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 18, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", overflowX: "auto" }}>
          <div style={{ padding: "12px 16px", fontWeight: 900, borderBottom: "1px solid rgba(255,255,255,0.1)", fontSize: 14, letterSpacing: "0.3px" }}>
            Quick platform comparison ({region})
          </div>

          <table className="platformCompareTable platformDesktopOnly" style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 720 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <th style={{ padding: 12 }}>Platform</th>
                <th style={{ padding: 12 }}>Best For</th>
                <th style={{ padding: 12 }}>Score</th>
                <th style={{ padding: 12 }}>Visit</th>
              </tr>
            </thead>
            <tbody>
              {content.platforms.map((item) => (
                <tr key={item.name} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: 12, fontWeight: 700 }}>{item.name}</td>
                  <td style={{ padding: 12, opacity: 0.8 }}>{item.shortLabel}</td>
                  <td style={{ padding: 12, fontWeight: 900, color: "#86efac" }}>{item.score}</td>
                  <td style={{ padding: 12 }}>
                    <AffiliateLink href={item.affiliateHref} eventLabel={`${region}_${item.name}`} style={smallVisitBtn()}>Visit →</AffiliateLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="platformCompareMobile">
            {content.platforms.map((item) => (
              <div key={item.name} style={{ padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 900, minWidth: 0 }}>{item.name}</div>
                  <div style={{ fontWeight: 900, color: "#86efac", whiteSpace: "nowrap", fontSize: 13 }}>{item.score}</div>
                  <AffiliateLink href={item.affiliateHref} eventLabel={`${region}_${item.name}`} style={smallVisitBtn()}>Visit →</AffiliateLink>
                </div>
                <div style={{ marginTop: 6, opacity: 0.8, lineHeight: 1.45, fontSize: 13 }}><strong>Best for:</strong> {item.shortLabel}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="platformDesktopOnly">
          <div style={{ marginTop: 18, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", padding: 16 }}>
            <div style={{ fontWeight: 950, marginBottom: 10 }}>How to choose a platform</div>
            <div style={{ display: "grid", gap: 10 }}>
              {content.chooser.map((item) => (
                <div key={item.title} style={{ opacity: 0.86, lineHeight: 1.55 }}>
                  <strong>{item.title}:</strong> {item.body}
                </div>
              ))}
              <div style={{ marginTop: 6, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.1)", opacity: 0.9, lineHeight: 1.55 }}>
                <strong>Common setup:</strong> analyse stocks on <strong>TradingView</strong>, then use a broker from the <strong>{region}</strong> list when you decide to invest.
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 22, display: "grid", gap: 16 }}>
          {content.platforms.map((item, idx) => (
            <section key={`${region}-${item.name}`} style={{ border: "1px solid rgba(255,255,255,0.14)", borderRadius: 18, padding: 18, background: "rgba(255,255,255,0.03)" }}>
              <div className="platformTopRow" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "nowrap" }}>
                <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                  <div className="platformTopPills" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 999, background: "rgba(168,85,247,0.14)", border: "1px solid rgba(168,85,247,0.22)", fontSize: 12, fontWeight: 900, letterSpacing: "0.3px" }}>#{idx + 1} • {item.shortLabel}</div>
                    <div className="platformHighlightPill" style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: 999, background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.22)", fontSize: 12, fontWeight: 900 }}>{item.highlight}</div>
                  </div>

                  <div className="platformHeaderBlock" style={{ marginTop: 14, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "nowrap" }}>
                    <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                      {item.recommended ? (
                        <div style={{ display: "inline-block", marginBottom: 6, padding: "4px 10px", borderRadius: 999, background: "linear-gradient(135deg, rgba(250,204,21,0.25), rgba(249,115,22,0.18))", border: "1px solid rgba(250,204,21,0.35)", fontSize: 11, fontWeight: 900, color: "#fde68a", letterSpacing: "0.4px" }}>★ RECOMMENDED</div>
                      ) : null}
                      <h2 style={{ margin: 0, fontSize: 28, letterSpacing: "-0.3px" }}>{item.name}</h2>
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#86efac" }}>{item.score}</div>
                        <div className="platformScoreLabel" style={{ opacity: 0.74, fontSize: 14 }}>MyStockHarbor platform score</div>
                      </div>
                      <p style={{ margin: "10px 0 0", opacity: 0.84, lineHeight: 1.6 }}><strong>Best for:</strong> {item.bestFor}</p>
                    </div>

                    <AffiliateLink href={item.affiliateHref} eventLabel={`${region}_${item.name}`} ariaLabel={`Visit ${item.name}`} style={{ textDecoration: "none", flex: "0 0 auto" }}>
                      <div className="platformLogoBox" style={{ width: item.name === "TradingView" ? 148 : 88, height: item.name === "TradingView" ? 68 : 88, borderRadius: item.name === "TradingView" ? 18 : 18, border: item.name === "TradingView" ? "1px solid rgba(59,130,246,0.26)" : "1px solid rgba(255,255,255,0.12)", background: item.name === "TradingView" ? "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(241,245,249,0.96))" : "#ffffff", boxShadow: item.name === "TradingView" ? "0 10px 24px rgba(0,0,0,0.22)" : "none", display: "flex", alignItems: "center", justifyContent: "center", padding: item.name === "TradingView" ? "10px 16px" : 10, overflow: "hidden", cursor: "pointer" }}>
                        <img src={item.logoSrc} alt={item.logoAlt} style={{ width: "100%", height: item.name === "TradingView" ? "auto" : "100%", maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
                      </div>
                    </AffiliateLink>
                  </div>

                  <p className="platformSummaryText" style={{ margin: "14px 0 0", opacity: 0.84, lineHeight: 1.6 }}>{item.summary}</p>
                </div>

                <div className="platformRightRail" style={{ width: 300, minWidth: 300, maxWidth: 300, display: "grid", gap: 12, alignContent: "start", flex: "0 0 300px" }}>
                  <AffiliateLink href={item.affiliateHref} eventLabel={`${region}_${item.name}`} style={ctaBtn()}>{item.ctaText} →</AffiliateLink>
                  {(region === "US" && (item.name === "Webull" || item.name === "Robinhood")) || item.name === "Trading 212" ? (
                    <div style={{ fontSize: 13, color: "#86efac", fontWeight: 800, textAlign: "center" }}>Most beginners start here</div>
                  ) : null}
                  <div style={{ fontSize: 13, opacity: 0.72, lineHeight: 1.5, textAlign: "center" }}>Visit official platform page</div>
                  {item.name === "TradingView" ? (
                    <div className="platformPromoCard" style={{ borderRadius: 18, border: "1px solid rgba(59,130,246,0.34)", background: "linear-gradient(135deg, rgba(37,99,235,0.22), rgba(30,41,59,0.22))", padding: 18, boxShadow: "0 12px 28px rgba(0,0,0,0.22)" }}>
                      <div style={{ fontSize: 18, lineHeight: 1.2, fontWeight: 950, color: "#dbeafe" }}>Analyse first. Invest second.</div>
                      <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.55, opacity: 0.88, color: "#e2e8f0" }}>This is the strongest funnel on the page. Use TradingView for chart analysis, then move to a broker when you are ready to act.</div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="platformGrid" style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr", gap: 14 }}>
                <div style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", padding: 14 }}>
                  <div style={{ fontWeight: 950, marginBottom: 8 }}>Why choose it</div>
                  <div style={{ opacity: 0.84, lineHeight: 1.55 }}>{item.note}</div>
                </div>
                <div style={{ borderRadius: 14, border: "1px solid rgba(34,197,94,0.22)", background: "rgba(34,197,94,0.06)", padding: 14 }}>
                  <div style={{ fontWeight: 950, marginBottom: 8 }}>Pros</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>{item.pros.map((pro) => <li key={pro} style={{ opacity: 0.88, lineHeight: 1.5 }}>{pro}</li>)}</ul>
                </div>
                <div style={{ borderRadius: 14, border: "1px solid rgba(239,68,68,0.22)", background: "rgba(239,68,68,0.06)", padding: 14 }}>
                  <div style={{ fontWeight: 950, marginBottom: 8 }}>Cons</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>{item.cons.map((con) => <li key={con} style={{ opacity: 0.88, lineHeight: 1.5 }}>{con}</li>)}</ul>
                </div>
              </div>

              <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.55, opacity: 0.62, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10 }}>{item.complianceNote}</div>
            </section>
          ))}
        </div>
      </div>

      <style>{`
        .wrap { max-width: 1080px; margin: 0 auto; padding: 24px; }
        .topNavShowDesktop { display: inline; }
        .topNavShowMobile { display: none; }
        .platformMobileOnly { display: none; }
        .platformCompareMobile { display: none; }
        button { font: inherit; }
        @media (max-width: 900px) {
          .topCompareGrid { grid-template-columns: 1fr !important; }
          .platformGrid { grid-template-columns: 1fr !important; }
          .platformTopRow { flex-wrap: wrap !important; }
        }
        @media (max-width: 760px) {
          .wrap { padding: 16px !important; }
          .topNavRow { display: grid !important; grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 8px !important; align-items: stretch !important; }
          .topNavRow a { width: 100% !important; min-width: 0 !important; min-height: 40px !important; padding: 8px 10px !important; font-size: 12px !important; border-radius: 12px !important; gap: 6px !important; justify-content: center !important; }
          .topNavIconOnlyMobile { padding-left: 0 !important; padding-right: 0 !important; }
          .topNavHideOnMobile { display: none !important; }
          .topNavShowDesktop { display: none !important; }
          .topNavShowMobile { display: inline !important; }
          .platformHeroTitle { margin: 6px 0 0 !important; font-size: 26px !important; line-height: 1.12 !important; letter-spacing: -0.5px !important; max-width: 100% !important; }
          .platformHeroText { font-size: 14px !important; line-height: 1.55 !important; }
          .platformDesktopOnly { display: none !important; }
          .platformMobileOnly { display: block !important; }
          .platformCompareMobile { display: block !important; }
          .platformTopPills { display: none !important; }
          .platformRightRail { width: 100% !important; min-width: 0 !important; max-width: 100% !important; flex: 1 1 100% !important; margin-top: 14px !important; }
          .platformHeaderBlock { align-items: flex-start !important; justify-content: space-between !important; gap: 12px !important; }
          .platformLogoBox { width: 56px !important; height: 56px !important; border-radius: 12px !important; padding: 8px !important; flex: 0 0 56px !important; }
          .platformScoreLabel { display: none !important; }
          .platformSummaryText { font-size: 14px !important; line-height: 1.5 !important; margin-top: 12px !important; }
          .platformPromoCard { padding: 14px !important; }
          .platformGrid { gap: 10px !important; margin-top: 14px !important; }
          .platformGrid > div { padding: 12px !important; }
          .platformGrid ul { gap: 6px !important; padding-left: 16px !important; }
          .platformGrid li { line-height: 1.4 !important; font-size: 13px !important; }
        }
      `}</style>
    </main>
  );
}
