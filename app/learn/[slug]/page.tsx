// app/learn/[slug]/page.tsx
import Link from "next/link";
import { getLesson } from "../lessons";

type Props = {
  params: {
    slug: string;
  };
};

export default function LessonPage({ params }: Props) {
  const slug = params?.slug ?? "";
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
          <p style={{ opacity: 0.7 }}>Slug received: {slug}</p>
          <Link href="/learn" style={{ color: "#93c5fd" }}>
            ← Back to Learn
          </Link>
        </div>

        <style>{`
          .wrap { max-width: 860px; margin: 0 auto; padding: 24px; }
          @media (max-width: 760px) {
            .wrap { padding: 16px !important; }
          }
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

            <div style={{ marginTop: 8, opacity: 0.75, lineHeight: 1.5 }}>
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

        <div
          style={{
            marginTop: 18,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.14)",
            background:
              "linear-gradient(135deg, rgba(59,130,246,0.22), rgba(16,185,129,0.12))",
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 900 }}>Visual (coming soon)</div>
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
            This box will hold a consistent-style diagram/image for:{" "}
            <strong>{lesson.title}</strong>
          </div>
        </div>

        <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
          {lesson.sections.map((s) => (
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
                  <p key={idx} style={{ margin: 0, opacity: 0.85 }}>
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <style>{`
        .wrap { max-width: 860px; margin: 0 auto; padding: 24px; }
        @media (max-width: 760px) {
          .wrap { padding: 16px !important; }
        }
      `}</style>
    </main>
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
