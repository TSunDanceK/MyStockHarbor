// app/learn/[slug]/page.tsx
export const dynamic = "force-dynamic";

import Link from "next/link";
import type { LessonImage } from "../lessons";
import { getLesson, getNextLesson } from "../all-lessons";
import LearnShell from "../LearnShell";

type Props = {
  params: { slug: string };
};

function TipBox(props: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 14,
        borderRadius: 16,
        border: "1px solid rgba(59,130,246,0.35)",
        background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(16,185,129,0.10))",
        padding: 14,
      }}
    >
      <div style={{ fontWeight: 950, marginBottom: 6 }}>{props.title}</div>
      <div style={{ opacity: 0.85, lineHeight: 1.55 }}>{props.children}</div>
    </div>
  );
}

function LessonFigure(props: { image: LessonImage; alt: string }) {
  return (
    <figure
      style={{
        margin: "14px 0 0",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "#06080d",
        overflow: "hidden",
      }}
    >
      <img
        src={props.image.src}
        alt={props.alt}
        style={{ width: "100%", height: "auto", display: "block" }}
      />
      <figcaption
        style={{
          padding: "10px 14px 12px",
          fontSize: 13,
          lineHeight: 1.5,
          opacity: 0.72,
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {props.image.caption}
      </figcaption>
    </figure>
  );
}

function nextLessonTopStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid rgba(250,204,21,0.52)",
    background:
      "linear-gradient(135deg, rgba(250,204,21,0.28), rgba(202,138,4,0.18))",
    color: "#fff7d6",
    textDecoration: "none",
    fontWeight: 950,
    fontSize: 13,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    boxShadow:
      "0 10px 24px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.10)",
    whiteSpace: "nowrap",
  };
}

function nextLessonBottomStyle(): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    textAlign: "center",
    padding: "18px 20px",
    borderRadius: 18,
    border: "1px solid rgba(250,204,21,0.56)",
    background:
      "linear-gradient(135deg, rgba(250,204,21,0.28), rgba(202,138,4,0.16))",
    color: "#fff8dc",
    textDecoration: "none",
    fontWeight: 950,
    fontSize: 16,
    letterSpacing: "0.05em",
    boxShadow:
      "0 14px 34px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",
  };
}

function relatedSetupsForSlug(slug: string) {
  const s = String(slug || "").trim().toLowerCase();

  if (s === "rsi") {
    return [
      {
        href: "/oversold-stocks-today",
        title: "Oversold Stocks Today",
        text: "Review live stocks currently screening as oversold and compare RSI extremes on real charts.",
      },
      {
        href: "/overbought-stocks-today",
        title: "Overbought Stocks Today",
        text: "Explore stocks screening as overbought and see how stretched momentum looks in practice.",
      },
      {
        href: "/bullish-bearish-divergence-stocks",
        title: "Bullish & Bearish Divergence Stocks",
        text: "Review live divergence setups where RSI or MACD may be disagreeing with price.",
      },
    ];
  }

  if (s === "macd") {
    return [
      {
        href: "/bullish-bearish-divergence-stocks",
        title: "Bullish & Bearish Divergence Stocks",
        text: "Review live divergence setups where MACD or RSI may be showing momentum disagreement.",
      },
      {
        href: "/best-trend-score-stocks",
        title: "Best Trend Score Stocks",
        text: "Explore stocks showing stronger trend structure and momentum alignment.",
      },
    ];
  }

  if (s === "moving-averages") {
    return [
      {
        href: "/stocks-near-200-day-moving-average",
        title: "Stocks Near 200-Day Moving Average",
        text: "Review live stocks currently testing a key long-term moving average level.",
      },
      {
        href: "/best-trend-score-stocks",
        title: "Best Trend Score Stocks",
        text: "Compare moving average structure with stocks currently showing strong trend alignment.",
      },
    ];
  }

  if (s === "how-to-identify-stock-trends") {
    return [
      {
        href: "/best-trend-score-stocks",
        title: "Best Trend Score Stocks",
        text: "Review live stocks showing stronger trend structure, leadership and momentum.",
      },
      {
        href: "/all-time-high-breakout-stocks",
        title: "All-Time High Breakout Stocks",
        text: "Explore stocks pushing into fresh highs where strong trend continuation can matter.",
      },
      {
        href: "/top-stocks-with-buy-signals",
        title: "Top Stocks With Buy Signals",
        text: "Compare strong trends with stocks currently showing broader bullish signal alignment.",
      },
    ];
  }

  if (s === "support-and-resistance") {
    return [
      {
        href: "/stocks-near-200-day-moving-average",
        title: "Stocks Near 200-Day Moving Average",
        text: "Review stocks trading around a widely watched long-term support or resistance area.",
      },
      {
        href: "/all-time-high-breakout-stocks",
        title: "All-Time High Breakout Stocks",
        text: "Explore charts where resistance is being broken and momentum is expanding.",
      },
    ];
  }

  if (s === "rsi-divergence" || s === "macd-divergence") {
    return [
      {
        href: "/bullish-bearish-divergence-stocks",
        title: "Bullish & Bearish Divergence Stocks",
        text: "Review live divergence setups currently being flagged across the market.",
      },
      {
        href: "/oversold-stocks-today",
        title: "Oversold Stocks Today",
        text: "Compare bullish divergence with oversold charts that may be approaching exhaustion.",
      },
      {
        href: "/overbought-stocks-today",
        title: "Overbought Stocks Today",
        text: "Compare bearish divergence with overextended charts that may be vulnerable to pullback.",
      },
    ];
  }

  return [];
}

function relatedSetupCard(): React.CSSProperties {
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

export default async function LessonPage({ params }: Props) {
  // Defensive: some builds pass params strangely (or as a Promise)
  const resolvedParams: any = await Promise.resolve(params as any);
  const slug = String(resolvedParams?.slug ?? "").trim();

  const lesson = getLesson(slug);
  const nextLesson = getNextLesson(slug);
  const relatedSetups = relatedSetupsForSlug(slug);

  if (!lesson) {
    return (
      <LearnShell>
        <h1 style={{ marginTop: 0 }}>Lesson not found</h1>
        <p style={{ opacity: 0.7 }}>Slug received: {slug || "(empty)"}</p>

        <div style={{ marginTop: 14 }}>
          <Link href="/learn" style={{ color: "#93c5fd" }}>
            ← Back to Learn
          </Link>
        </div>
      </LearnShell>
    );
  }

  return (
    <LearnShell activeSlug={lesson.slug}>
      <div style={{ display: "grid", gap: 12 }}>
        <div
          style={{
            fontSize: 12,
            opacity: 0.72,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {lesson.category}
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: 34,
            lineHeight: 1.15,
            letterSpacing: "-0.4px",
            maxWidth: 760,
          }}
        >
          {lesson.title}
        </h1>

        <div
          style={{
            margin: 0,
            opacity: 0.78,
            lineHeight: 1.6,
            maxWidth: 760,
            fontSize: 17,
          }}
        >
          {lesson.summary}
        </div>
      </div>

      {/* Course-style intro */}
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {nextLesson ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
            }}
          >
            <Link
              href={`/learn/${encodeURIComponent(nextLesson.slug)}`}
              style={nextLessonTopStyle()}
            >
              Next lesson →
            </Link>
          </div>
        ) : null}

        <TipBox title="How to use this lesson">
          Read it once, then open a chart and try to spot the same idea in 60 seconds. Repetition beats complexity.
        </TipBox>
      </div>

      {/* Sections */}
      <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
        {lesson.sections.map((s) => {
          const isMistakes = s.heading.toLowerCase().includes("common mistakes");

          if (isMistakes) {
            return (
              <TipBox key={s.heading} title="Common mistakes (avoid these)">
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
                  {s.body.map((p, i) => (
                    <li key={i} style={{ opacity: 0.92, lineHeight: 1.55 }}>
                      {p}
                    </li>
                  ))}
                </ul>
              </TipBox>
            );
          }

          return (
            <section
              key={s.heading}
              style={{
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 16,
                padding: 16,
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <h2 style={{ margin: 0, fontWeight: 950, fontSize: 19 }}>{s.heading}</h2>

              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {s.body.map((p, i) => (
                  <p key={i} style={{ margin: 0, opacity: 0.86, lineHeight: 1.65 }}>
                    {p}
                  </p>
                ))}
              </div>

              {s.image ? (
                <LessonFigure image={s.image} alt={`${lesson.title} — ${s.heading}`} />
              ) : null}
            </section>
          );
        })}
      </div>

      {/* Outro */}
      <div style={{ marginTop: 18 }}>
        <TipBox title="Next step">
          Open the Dashboard, pick a stock, and try to explain what you see in one sentence. If you can explain it simply,
          you understand it.
        </TipBox>
      </div>

      {relatedSetups.length ? (
        <section
          style={{
            marginTop: 18,
            border: "1px solid rgba(239,68,68,0.24)",
            borderRadius: 18,
            padding: 18,
            background: "linear-gradient(180deg, rgba(24,12,12,0.96), rgba(14,7,7,0.98))",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 12px",
              borderRadius: 999,
              background:
                "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(127,29,29,0.12))",
              border: "1px solid rgba(239,68,68,0.36)",
              color: "#fee2e2",
              fontWeight: 950,
              letterSpacing: "0.08em",
              fontSize: 12,
            }}
          >
            RELATED LIVE SETUPS
          </div>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 12,
            }}
          >
            {relatedSetups.map((item) => (
              <Link key={item.href} href={item.href} style={relatedSetupCard()}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{item.title}</div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 13,
                    opacity: 0.75,
                    lineHeight: 1.5,
                  }}
                >
                  {item.text}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {nextLesson ? (
        <div style={{ marginTop: 18 }}>
          <Link
            href={`/learn/${encodeURIComponent(nextLesson.slug)}`}
            style={nextLessonBottomStyle()}
          >
            MOVE TO {nextLesson.title.toUpperCase()} LESSON →
          </Link>
        </div>
      ) : (
        <div style={{ marginTop: 18 }}>
          <Link
            href="/learn"
            style={{
              display: "block",
              width: "100%",
              textAlign: "center",
              padding: "18px 20px",
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#f8fafc",
              textDecoration: "none",
              fontWeight: 950,
              fontSize: 16,
              letterSpacing: "0.4px",
            }}
          >
            BACK TO ALL LESSONS
          </Link>
        </div>
      )}
    </LearnShell>
  );
}
