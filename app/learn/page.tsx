// app/learn/page.tsx
import Link from "next/link";
import { lessonsByCategory } from "./lessons";

export default function LearnPage() {
  const basics = lessonsByCategory("Basics");
  const indicators = lessonsByCategory("Indicators");
  const divergencies = lessonsByCategory("Divergencies");

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
            <h1 style={{ margin: 0, fontSize: 34, letterSpacing: "-0.4px" }}>
              Learn the Basics
            </h1>
            <p style={{ margin: "8px 0 0", opacity: 0.75, lineHeight: 1.5 }}>
              Short lessons on reading charts, key concepts, and the indicators used in MyStockHarbor.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/" style={btn()}>
              ← Dashboard
            </Link>
            <Link href="/pickers" style={btn()}>
              Find Stocks →
            </Link>
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
  <div style={{ fontWeight: 950, marginBottom: 6 }}>
    New to trading?
  </div>

  <div style={{ opacity: 0.85, lineHeight: 1.55 }}>
    Before learning indicators and chart patterns, it's helpful to choose a
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

<div style={{ marginTop: 22, display: "grid", gap: 18 }}>
  <Section title="BASICS" items={basics} />
  <Section title="INDICATORS" items={indicators} />
  <Section title="DIVERGENCIES" items={divergencies} />

  <section
    style={{
      border: "1px solid rgba(255,255,255,0.14)",
      borderRadius: 16,
      padding: 16,
      background: "rgba(255,255,255,0.03)",
    }}
  >
    <div style={{ fontWeight: 950, letterSpacing: "0.6px", opacity: 0.9 }}>
      EXTRA GUIDES
    </div>

    <div
      style={{
        marginTop: 12,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 12,
      }}
    >
      <Link
        href="/how-to-read-stock-charts"
        style={learnGuideCard()}
      >
        <div style={{ fontWeight: 900, fontSize: 16 }}>How to Read Stock Charts</div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
          A beginner-friendly guide to trend, support, resistance, and chart context.
        </div>
      </Link>

      <Link
        href="/best-stock-indicators-for-beginners"
        style={learnGuideCard()}
      >
        <div style={{ fontWeight: 900, fontSize: 16 }}>Best Stock Indicators for Beginners</div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
          Learn which indicators matter most when you are just starting out.
        </div>
      </Link>

      <Link
        href="/what-is-rsi-indicator"
        style={learnGuideCard()}
      >
        <div style={{ fontWeight: 900, fontSize: 16 }}>What Is RSI Indicator?</div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
          Understand overbought, oversold, and how RSI helps read momentum.
        </div>
      </Link>

      <Link
        href="/what-is-macd-indicator"
        style={learnGuideCard()}
      >
        <div style={{ fontWeight: 900, fontSize: 16 }}>What Is MACD Indicator?</div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
          Learn how MACD helps confirm momentum and possible trend shifts.
        </div>
      </Link>

      <Link
        href="/what-is-vwap-indicator"
        style={learnGuideCard()}
      >
        <div style={{ fontWeight: 900, fontSize: 16 }}>What Is VWAP Indicator?</div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
          Learn how traders use VWAP to judge fair value and price stretch.
        </div>
      </Link>
    </div>
  </section>
</div>
      </div>

      <style>{`
        .wrap { max-width: 980px; margin: 0 auto; padding: 24px; }
        @media (max-width: 760px) {
          .wrap { padding: 16px !important; }
        }
      `}</style>
    </main>
  );
}
function learnCardHref(slug: string) {
  if (slug === "macd-divergence") return "/learn/macd";
  if (slug === "rsi-divergence") return "/learn/rsi";
  if (slug === "how-to-identify-stock-trends") return "/how-to-identify-stock-trends";
  return `/learn/${encodeURIComponent(slug)}`;
}
function Section(props: { title: string; items: { slug: string; title: string; summary: string }[] }) {
  const { title, items } = props;

  return (
    <section
      style={{
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 16,
        padding: 16,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ fontWeight: 950, letterSpacing: "0.6px", opacity: 0.9 }}>{title}</div>

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {items.map((it) => (
          <Link
            key={it.slug}
            href={learnCardHref(it.slug)}
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 14,
              padding: 14,
              background: "rgba(255,255,255,0.06)",
              color: "#f1f5f9",
              textDecoration: "none",
              display: "block",
              transition: "transform 120ms ease, background 120ms ease",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 16 }}>{it.title}</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>{it.summary}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function btn(): React.CSSProperties {
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
function learnGuideCard(): React.CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 14,
    padding: 14,
    background: "rgba(255,255,255,0.06)",
    color: "#f1f5f9",
    textDecoration: "none",
    display: "block",
    transition: "transform 120ms ease, background 120ms ease",
  };
}
