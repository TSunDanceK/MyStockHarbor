// app/learn/[slug]/page.tsx
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getLesson, getNextLesson } from "../lessons";

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

function LessonImages(props: { slug: string; which: 1 | 2 | 3 }) {
  const { slug, which } = props;
  const src = `/learn/${slug}/${String(which).padStart(2, "0")}.png`;

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
        src={src}
        alt={`Lesson diagram ${which}`}
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          opacity: 1,
          filter: "none",
          mixBlendMode: "normal",
        }}
      />
    </figure>
  );
}

export default async function LessonPage({ params }: Props) {
  // Defensive: some builds pass params strangely (or as a Promise)
  const resolvedParams: any = await Promise.resolve(params as any);
  const slug = String(resolvedParams?.slug ?? "").trim();

  const lesson = getLesson(slug);
  const nextLesson = getNextLesson(slug);

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
          {lesson.sections.map((s, idx) => {
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
                <div style={{ fontWeight: 950, fontSize: 18 }}>{s.heading}</div>

                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {s.body.map((p, i) => (
                    <p key={i} style={{ margin: 0, opacity: 0.86, lineHeight: 1.6 }}>
                      {p}
                    </p>
                  ))}
                </div>

                {/* Images: 01 after section 1, 02 after section 3, 03 after section 5 */}
                {idx === 0 ? <LessonImages slug={lesson.slug} which={1} /> : null}
                {idx === 2 ? <LessonImages slug={lesson.slug} which={2} /> : null}
                {idx === 4 ? <LessonImages slug={lesson.slug} which={3} /> : null}
              </section>
            );
          })}
        </div>

        {/* Outro */}
        {/* Outro */}
        <div style={{ marginTop: 18 }}>
          <TipBox title="Next step">
            Open the Dashboard, pick a stock, and try to explain what you see in one sentence. If you can explain it simply,
            you understand it.
          </TipBox>
        </div>

        {nextLesson ? (
          <div style={{ marginTop: 18 }}>
            <Link
              href={`/learn/${encodeURIComponent(nextLesson.slug)}`}
              style={{
                display: "block",
                width: "100%",
                textAlign: "center",
                padding: "18px 20px",
                borderRadius: 18,
                border: "1px solid rgba(59,130,246,0.38)",
                background:
                  "linear-gradient(135deg, rgba(59,130,246,0.24), rgba(16,185,129,0.14))",
                color: "#f8fafc",
                textDecoration: "none",
                fontWeight: 950,
                fontSize: 16,
                letterSpacing: "0.4px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.22)",
              }}
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
      </div>

      <style>{`
        .wrap { max-width: 920px; margin: 0 auto; padding: 24px; }
        @media (max-width: 760px) { .wrap { padding: 16px !important; } }
      `}</style>
    </main>
  );
}
