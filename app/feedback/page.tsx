import type { Metadata } from "next";
import Link from "next/link";
import FeedbackForm from "./FeedbackForm";

export const metadata: Metadata = {
  title: "Feedback | MyStockHarbor",
  description:
    "Tell MyStockHarbor what you'd like to see, or let us know about something that isn't working.",
};

export default function FeedbackPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <Link
            href="/"
            style={{
              color: "#93c5fd",
              textDecoration: "none",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            ← Back to Dashboard
          </Link>
        </div>

        <section
          style={{
            background: "#0b1220",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
          }}
        >
          <h1
            style={{
              marginTop: 0,
              marginBottom: 10,
              fontSize: 32,
              lineHeight: 1.1,
              fontWeight: 900,
            }}
          >
            Need something you don&apos;t see?
          </h1>

          <p
            style={{
              fontSize: 16,
              lineHeight: 1.7,
              opacity: 0.88,
              marginTop: 0,
            }}
          >
            Let us know what&apos;s missing, what&apos;s confusing, or what
            you&apos;d like us to build next — we read every submission.
          </p>

          <div style={{ marginTop: 24 }}>
            <FeedbackForm />
          </div>

          <p style={{ fontSize: 14, marginTop: 28, opacity: 0.7 }}>
            Prefer email, or have a business enquiry?{" "}
            <Link
              href="/contact"
              style={{
                color: "#93c5fd",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              Visit our Contact page →
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
