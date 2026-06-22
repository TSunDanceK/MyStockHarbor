// app/learn/[slug]/page.tsx
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getLesson, getNextLesson } from "../lessons";

type Props = {
  params: { slug: string };
};


function siteNavCss(wrapMaxWidth: number) {
  return `
    .wrap {
      max-width: ${wrapMaxWidth}px;
      margin: 0 auto;
      padding: 24px;
    }

    a:hover {
      filter: brightness(1.05);
    }

    @media (max-width: 760px) {
      .wrap {
        padding: 16px !important;
      }
    }
  `;
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

<style>{siteNavCss(920)}</style>
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
      </div>

<style>{siteNavCss(920)}</style>
    </main>
  );
}
