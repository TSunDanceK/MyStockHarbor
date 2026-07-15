"use client";

import { useState, type CSSProperties } from "react";

type ArticleForBrief = {
  title: string;
  link: string;
  source: string | null;
  pubDate: string | null;
  description: string | null;
};

type WhyThisMattersProps = {
  symbol: string;
  companyName: string;
  trend: string;
  newsScoreLabel: string;
  item: ArticleForBrief;
  /**
   * Algorithmic fallback text, computed server-side (via
   * lib/stock-news-templates.ts) and passed in as a prop. Shown instantly
   * on expand -- no network call, no blank/broken state. Optionally
   * upgraded to an AI-generated line below.
   */
  fallbackText: string;
};

type WhyItMattersResponse = {
  ai?: boolean;
  whyItMatters?: string | null;
};

export default function WhyThisMatters({
  symbol,
  companyName,
  trend,
  newsScoreLabel,
  item,
  fallbackText,
}: WhyThisMattersProps) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState(fallbackText);
  const [attempted, setAttempted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    const next = !expanded;
    setExpanded(next);

    if (!next || attempted) return;
    setAttempted(true);
    setLoading(true);

    try {
      const res = await fetch("/api/stock-news/why-it-matters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, companyName, trend, newsScoreLabel, item }),
      });

      if (res.ok) {
        const data = (await res.json()) as WhyItMattersResponse;
        if (data.ai && typeof data.whyItMatters === "string" && data.whyItMatters.trim()) {
          setText(data.whyItMatters.trim());
        }
      }
    } catch {
      // Network or API failure: keep showing the algorithmic fallback that
      // is already on screen. This must never surface as a visible error.
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        style={toggleButtonStyle}
      >
        Why this matters
        <span aria-hidden="true" style={chevronStyle}>{expanded ? "▴" : "▾"}</span>
      </button>
      {expanded ? (
        <div style={whyItMattersBoxStyle}>
          <div style={whyItMattersLabelStyle}>Why this matters</div>
          <div style={whyItMattersTextStyle}>
            {text}
            {loading ? <span style={loadingTagStyle}> Checking for an AI read…</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const toggleButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.28)",
  background: "rgba(59,130,246,0.08)",
  color: "#bfdbfe",
  fontSize: 12,
  fontWeight: 850,
  letterSpacing: "0.02em",
  cursor: "pointer",
};

const chevronStyle: CSSProperties = {
  fontSize: 10,
};

const whyItMattersBoxStyle: CSSProperties = {
  marginTop: 10,
  border: "1px solid rgba(59,130,246,0.16)",
  borderRadius: 14,
  padding: 12,
  background: "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(255,255,255,0.02))",
};

const whyItMattersLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "rgba(191,219,254,0.86)",
};

const whyItMattersTextStyle: CSSProperties = {
  marginTop: 7,
  fontSize: 14,
  lineHeight: 1.65,
  color: "rgba(241,245,249,0.82)",
};

const loadingTagStyle: CSSProperties = {
  fontSize: 12,
  color: "rgba(191,219,254,0.55)",
  fontStyle: "italic",
};
