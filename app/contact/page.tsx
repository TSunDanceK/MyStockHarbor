import Link from "next/link";

export default function ContactPage() {
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
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
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
              marginBottom: 16,
              fontSize: 34,
              lineHeight: 1.1,
              fontWeight: 900,
            }}
          >
            Contact MyStockHarbor
          </h1>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            For general questions, feedback, website suggestions, or business
            enquiries, you can contact MyStockHarbor using the email address
            below.
          </p>

          <div
            style={{
              marginTop: 20,
              padding: 18,
              borderRadius: 14,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            <div style={{ fontSize: 13, opacity: 0.72, marginBottom: 8 }}>
              Contact email
            </div>

            <a
              href="mailto:admin@mystockharbor.com"
              style={{
                color: "#93c5fd",
                textDecoration: "none",
                fontWeight: 800,
                fontSize: 18,
              }}
            >
              admin@mystockharbor.com
            </a>
          </div>

          <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
            What to contact us about
          </h2>

          <ul style={{ lineHeight: 1.9, paddingLeft: 22, opacity: 0.92 }}>
            <li>Website feedback and suggestions</li>
            <li>Questions about tools or platform features</li>
            <li>General business enquiries</li>
            <li>Reporting bugs or incorrect information</li>
          </ul>

          <h2 style={{ marginTop: 28, fontSize: 24, fontWeight: 850 }}>
            Important notice
          </h2>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            MyStockHarbor is an educational platform. Messages sent through this
            contact address should not be interpreted as a request for personal
            financial advice, and no investment advice is provided through this
            website.
          </p>

          <p style={{ fontSize: 16, lineHeight: 1.7, opacity: 0.92 }}>
            For more information about the platform, please visit the About
            page.
          </p>

          <p style={{ fontSize: 16 }}>
            <Link
              href="/about"
              style={{
                color: "#93c5fd",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              Learn more about MyStockHarbor →
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
