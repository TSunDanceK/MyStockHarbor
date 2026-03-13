import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Best Trading Platform for Beginners | MyStockHarbor",
  description:
    "Looking for the best trading platform for beginners? Compare beginner-friendly stock platforms like Trading 212, TradingView, eToro, and Interactive Brokers.",
};

export default function BestTradingPlatformForBeginnersPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <div
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "28px 20px 40px",
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
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
            }}
          >
            ← Dashboard
          </Link>

          <Link
            href="/platforms"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#f1f5f9",
              textDecoration: "none",
              fontWeight: 850,
            }}
          >
            Platforms →
          </Link>
        </div>

        <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 800, letterSpacing: "0.3px" }}>
          BEGINNER PLATFORM GUIDE
        </div>

        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 36,
            lineHeight: 1.15,
            letterSpacing: "-0.5px",
          }}
        >
          Best Trading Platform for Beginners
        </h1>

        <p
          style={{
            marginTop: 14,
            fontSize: 17,
            lineHeight: 1.7,
            opacity: 0.86,
          }}
        >
          If you are completely new to trading or buying stocks, the best trading platform for
          beginners is usually the one that feels easiest to understand, easiest to navigate, and
          least overwhelming when you place your first trade.
        </p>

        <div
          style={{
            marginTop: 18,
            padding: 18,
            borderRadius: 16,
            border: "1px solid rgba(34,197,94,0.28)",
            background:
              "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.78 }}>BEST PICK FOR MOST BEGINNERS</div>
          <div style={{ marginTop: 6, fontSize: 28, fontWeight: 900 }}>Trading 212</div>
          <p style={{ margin: "10px 0 0", opacity: 0.86, lineHeight: 1.6 }}>
            Trading 212 is one of the easiest platforms for beginners because the interface is
            simple, the app feels approachable, and it removes a lot of the friction that makes
            more advanced brokers feel intimidating.
          </p>

          <div style={{ marginTop: 14 }}>
            <a
              href="/api/go/trading212"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "13px 18px",
                borderRadius: 14,
                border: "1px solid rgba(34,197,94,0.45)",
                background:
                  "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
                color: "#f8fafc",
                textDecoration: "none",
                fontWeight: 900,
                minHeight: 48,
                boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
                whiteSpace: "nowrap",
              }}
            >
              Visit Trading 212 →
            </a>
          </div>
        </div>

        <section style={{ marginTop: 26 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>What beginners should actually look for</h2>
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <p style={{ margin: 0, lineHeight: 1.65, opacity: 0.86 }}>
              <strong>Easy interface:</strong> the platform should feel simple the first time you
              open it.
            </p>
            <p style={{ margin: 0, lineHeight: 1.65, opacity: 0.86 }}>
              <strong>Low overwhelm:</strong> beginner users usually do better with fewer advanced
              tools at the start.
            </p>
            <p style={{ margin: 0, lineHeight: 1.65, opacity: 0.86 }}>
              <strong>Room to learn:</strong> the platform should still be useful as you get more
              comfortable buying stocks and ETFs.
            </p>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>Best beginner platform combinations</h2>

          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 18 }}>Best simple setup</div>
              <p style={{ margin: "8px 0 0", opacity: 0.86, lineHeight: 1.6 }}>
                Use <strong>Trading 212</strong> if you want the easiest route to buying stocks and
                ETFs without needing a more advanced broker layout.
              </p>
            </div>

            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 18 }}>Best learn-to-chart setup</div>
              <p style={{ margin: "8px 0 0", opacity: 0.86, lineHeight: 1.6 }}>
                Use <strong>TradingView</strong> for chart analysis, then place trades with a broker
                like <strong>Trading 212</strong>.
              </p>
            </div>

            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 18 }}>Best grow-into-it setup</div>
              <p style={{ margin: "8px 0 0", opacity: 0.86, lineHeight: 1.6 }}>
                If you want something more serious long term, <strong>Interactive Brokers</strong>
                is stronger, but it is less beginner-friendly on day one.
              </p>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 24, margin: 0 }}>MyStockHarbor recommendation</h2>
          <p style={{ marginTop: 12, opacity: 0.86, lineHeight: 1.7 }}>
            For most people starting out, the easiest route is to use <strong>Trading 212</strong>{" "}
            as your beginner broker and use <strong>TradingView</strong> if you want better charts
            and analysis tools as you improve.
          </p>
        </section>

        <div
          style={{
            marginTop: 30,
            paddingTop: 18,
            borderTop: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/platforms"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#f1f5f9",
              textDecoration: "none",
              fontWeight: 850,
            }}
          >
            Compare all platforms →
          </Link>

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
            }}
          >
            Go to dashboard →
          </Link>
        </div>
      </div>
    </main>
  );
}
