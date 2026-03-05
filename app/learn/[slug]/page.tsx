// app/learn/[slug]/page.tsx
import Link from "next/link";
import { getLesson } from "../lessons";

type Props = {
  params: { slug: string };
};

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

function ImageSlot(props: { label: string }) {
  return (
    <div
      style={{
        marginTop: 14,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.03)",
        padding: 14,
      }}
    >
      <div style={{ fontWeight: 900 }}>Visual (coming soon)</div>
      <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6, lineHeight: 1.5 }}>
        {props.label}
      </div>
    </div>
  );
}

export default async function LessonPage({ params }: Props) {
  // Extra defensive slug handling
const { slug } = await params;

  const lesson = getLesson(slug);

  if (!lesson) {
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
          <h1 style={{ marginTop: 0 }}>Lesson not found</h1>
          <p style={{ opacity: 0.7 }}>Slug received: {slug || "(empty)"}</p>
          <pre style={{ marginTop: 10, fontSize: 12, opacity: 0.85, whiteSpace: "pre-wrap" }}>
            Params debug: {JSON.stringify(rawParams)}
          </pre>

          <div style={{ marginTop: 14 }}>
            <Link href="/learn" style={{ color: "#93c5fd" }}>
              ← Back to Learn
            </Link>
          </div>
        </div>

        <style>{`
          .wrap { max-width: 920px; margin: 0 auto; padding: 24px; }
          @media (max-width: 760px) { .wrap { padding: 16px !important; } }
        `}</style>
      </main>
    );
  }

  // Auto-detect “Common mistakes” section to turn into a tip box
  const mistakes = lesson.sections.find((s) => s.heading.toLowerCase().includes("common mistakes"));

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
        {/* Top header */}
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
              {lesson.category.toUpperCase()}
            </div>

            <h1 style={{ margin: "6px 0 0", fontSize: 34, letterSpacing: "-0.4px" }}>
              {lesson.title}
            </h1>

            <div style={{ marginTop: 8, opacity: 0.78, lineHeight: 1.5 }}>
              {lesson.summary}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/learn" style={btn()}>
              ← Learn
            </Link>
            <Link href="/" style={btn()}>
              Dashboard →
            </Link>
          </div>
        </div>

        {/* Course-style intro */}
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
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
                    {s.body.map((p, idx) => (
                      <li key={idx} style={{ opacity: 0.92, lineHeight: 1.55 }}>
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
                <div style={{ fontWeight: 950, fontSize: 18 }}>{s.heading}</div>
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {s.body.map((p, idx) => (
                    <p key={idx} style={{ margin: 0, opacity: 0.86, lineHeight: 1.6 }}>
                      {p}
                    </p>
                  ))}
                </div>

                {/* Simple “image slot” after first 3 sections to keep a consistent look */}
                {idxIsImageSlot(lesson.sections, s.heading) ? (
                  <ImageSlot label={`Image idea: ${lesson.title} — ${s.heading}`} />
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
      </div>

      <style>{`
        .wrap { max-width: 920px; margin: 0 auto; padding: 24px; }
        @media (max-width: 760px) { .wrap { padding: 16px !important; } }
      `}</style>
    </main>
  );
}

// Helper: show image slot after certain headings (keeps layout consistent)
function idxIsImageSlot(sections: { heading: string }[], heading: string) {
  const idx = sections.findIndex((s) => s.heading === heading);
  return idx === 0 || idx === 2; // image after section 1 and 3
}
