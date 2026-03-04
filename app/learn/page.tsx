// app/learn/page.tsx
import Link from "next/link";
import { lessonsByCategory } from "./lessons";

export default function LearnPage() {
  const basics = lessonsByCategory("Basics");
  const indicators = lessonsByCategory("Indicators");

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "system-ui, Arial",
        background: "#06080d",
        color: "#f1f5f9",
        minHeight: "100vh",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 34, letterSpacing: "-0.4px" }}>Learn the Basics</h1>
            <p style={{ margin: "8px 0 0", opacity: 0.75 }}>
              Short lessons on reading charts, key concepts, and the indicators used in MyStockHarbor.
            </p>
          </div>

          <Link
            href="/"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#f1f5f9",
              textDecoration: "none",
              fontWeight: 850,
              whiteSpace: "nowrap",
            }}
          >
            ← Back to Dashboard
          </Link>
        </div>

        <div style={{ marginTop: 22, display: "grid", gap: 18 }}>
          <Section title="BASICS" items={basics} />
          <Section title="INDICATORS" items={indicators} />
        </div>
      </div>
    </main>
  );
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
            href={`/learn/${it.slug}`}
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 14,
              padding: 14,
              background: "rgba(255,255,255,0.06)",
              color: "#f1f5f9",
              textDecoration: "none",
              display: "block",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 16 }}>{it.title}</div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>{it.summary}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
