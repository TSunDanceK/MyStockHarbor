"use client";

import { useState, type CSSProperties } from "react";

type InsightArticle = {
  title: string;
  source: string | null;
  pubDate: string | null;
  description: string | null;
};

type AiInsightCardProps = {
  symbol: string;
  companyName: string;
  trend: string | null;
  // null when there was nothing to score. The route used to substitute
  // "Neutral"/50 for a missing score and hand that to the model as fact, so the
  // absence has to survive the trip rather than be filled in at either end.
  newsScore: { score: number; tone: "green" | "yellow" | "red"; label: string } | null;
  earningsScore: { label: string };
  lastRsi: number | null;
  priceVs50: number | null;
  priceVs200: number | null;
  recentHigh: number | null;
  recentLow: number | null;
  items: InsightArticle[];
  /**
   * Algorithmic fallback copy, computed server-side (via
   * lib/stock-news-templates.ts) and passed in as a prop. Used only if the
   * /api/stock-news/insight route itself is unreachable -- the route
   * normally computes and returns its own server-side fallback, so this is
   * a last-resort safety net that guarantees the button never produces an
   * error state.
   */
  fallbackBeyondHeadline: string;
  fallbackWhatItMeans: string[];
};

type InsightResponse = {
  ai?: boolean;
  beyondHeadline?: string;
  whatItMeans?: string[];
};

type InsightResult = {
  ai: boolean;
  beyondHeadline: string;
  whatItMeans: string[];
};

export default function AiInsightCard({
  symbol,
  companyName,
  trend,
  newsScore,
  earningsScore,
  lastRsi,
  priceVs50,
  priceVs200,
  recentHigh,
  recentLow,
  items,
  fallbackBeyondHeadline,
  fallbackWhatItMeans,
}: AiInsightCardProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [result, setResult] = useState<InsightResult | null>(null);

  async function handleGenerate() {
    if (status === "loading") return;
    setStatus("loading");

    try {
      const res = await fetch("/api/stock-news/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          companyName,
          trend,
          newsScore,
          earningsScore,
          lastRsi,
          priceVs50,
          priceVs200,
          recentHigh,
          recentLow,
          items,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as InsightResponse;
        setResult({
          ai: !!data.ai,
          beyondHeadline:
            typeof data.beyondHeadline === "string" && data.beyondHeadline.trim()
              ? data.beyondHeadline
              : fallbackBeyondHeadline,
          whatItMeans:
            Array.isArray(data.whatItMeans) && data.whatItMeans.length
              ? data.whatItMeans
              : fallbackWhatItMeans,
        });
        setStatus("done");
        return;
      }
    } catch {
      // Route unreachable or errored outright -- fall through below.
    }

    // Never show a broken/error state: fall back to the algorithmic read
    // that was already computed for this page server-side.
    setResult({ ai: false, beyondHeadline: fallbackBeyondHeadline, whatItMeans: fallbackWhatItMeans });
    setStatus("done");
  }

  return (
    <section style={{ ...featuredInsightShellStyle, position: "relative" }}>
      <div style={sectionEyebrowStyle}>Beyond the headline</div>
      <h2 style={sectionTitleStyle}>A deeper look for beginners</h2>

      {!result ? (
        <div style={{ marginTop: 16 }}>
          <p style={bodyCopyStyle}>
            Generate a short AI read that goes beyond the headlines above, plus a
            plain-English breakdown of what it could mean going forward.
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={status === "loading"}
            style={generateButtonStyle(status === "loading")}
          >
            {status === "loading" ? "Generating…" : "Generate AI Insight"}
          </button>
        </div>
      ) : (
        <>
          <p style={bodyCopyStyle}>{result.beyondHeadline}</p>
          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
            {result.whatItMeans.map((line) => (
              <div key={line} style={bulletRowStyle}>
                <div style={bulletDotStyle} />
                <div style={bulletTextStyle}>{line}</div>
              </div>
            ))}
          </div>
          <div style={sourceTagStyle}>{result.ai ? "AI-generated read" : "Automated read"}</div>
        </>
      )}
    </section>
  );
}

const featuredInsightShellStyle: CSSProperties = {
  border: "1px solid rgba(59,130,246,0.22)",
  borderRadius: 24,
  padding: 20,
  background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(7,12,22,0.96))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
};

const sectionEyebrowStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 950,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "rgba(147,197,253,0.82)",
};

const sectionTitleStyle: CSSProperties = {
  margin: "8px 0 0 0",
  fontSize: 28,
  lineHeight: 1.08,
  letterSpacing: "-0.04em",
};

const bodyCopyStyle: CSSProperties = {
  margin: "14px 0 0 0",
  fontSize: 15,
  lineHeight: 1.72,
  color: "rgba(241,245,249,0.82)",
};

const bulletRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "10px minmax(0, 1fr)",
  gap: 12,
  alignItems: "start",
};

const bulletDotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 999,
  marginTop: 7,
  background: "linear-gradient(135deg, #60a5fa, #22c55e)",
  boxShadow: "0 0 0 4px rgba(59,130,246,0.10)",
};

const bulletTextStyle: CSSProperties = {
  fontSize: 15,
  lineHeight: 1.7,
  color: "rgba(241,245,249,0.84)",
};

function generateButtonStyle(loading: boolean): CSSProperties {
  return {
    marginTop: 16,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    padding: "11px 18px",
    borderRadius: 999,
    border: "1px solid rgba(59,130,246,0.34)",
    background: loading
      ? "rgba(59,130,246,0.10)"
      : "linear-gradient(135deg, rgba(59,130,246,0.20), rgba(37,99,235,0.12))",
    color: "#dbeafe",
    fontWeight: 900,
    fontSize: 13,
    letterSpacing: "0.03em",
    cursor: loading ? "default" : "pointer",
    opacity: loading ? 0.75 : 1,
  };
}

const sourceTagStyle: CSSProperties = {
  marginTop: 14,
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "rgba(147,197,253,0.55)",
};
