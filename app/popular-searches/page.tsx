import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { readSearchDemand, SEARCH_DEMAND_WINDOW_DAYS } from "@/lib/server/searchDemand";
import { getCompanyNameMap } from "@/lib/server/companyNames";

// Gated "Coming Soon" launch: middleware.ts sets x-msh-ps-preview:"1" only for
// an allow-listed IP or a valid preview cookie (see the /popular-searches block
// there). Everyone else gets the Coming Soon placeholder -- same URL, 200, no
// broken link. noindex while gated so Google doesn't index either state.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Popular Searches | MyStockHarbor",
  description: "The tickers MyStockHarbor visitors are searching for most.",
  robots: { index: false, follow: false },
  alternates: { canonical: "https://www.mystockharbor.com/popular-searches" },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at 12% 0%, rgba(59,130,246,0.16), transparent 30%), radial-gradient(circle at 92% 4%, rgba(34,197,94,0.08), transparent 28%), #06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 18px 60px" }}>{children}</div>
    </main>
  );
}

function ComingSoon() {
  return (
    <Shell>
      <section
        style={{
          marginTop: 40,
          border: "1px solid rgba(96,165,250,0.22)",
          borderRadius: 24,
          padding: "40px 28px",
          background: "linear-gradient(180deg, rgba(10,16,32,0.96), rgba(6,10,18,0.98))",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 13px",
            borderRadius: 999,
            border: "1px solid rgba(96,165,250,0.28)",
            background: "rgba(59,130,246,0.10)",
            color: "#93c5fd",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Coming soon
        </div>
        <h1 style={{ margin: "16px 0 0", fontSize: 40, lineHeight: 1.05, letterSpacing: "-0.04em" }}>
          Popular Searches
        </h1>
        <p style={{ margin: "12px auto 0", maxWidth: 560, fontSize: 16, lineHeight: 1.65, color: "rgba(226,232,240,0.78)" }}>
          We&rsquo;re building a live view of the tickers MyStockHarbor visitors are looking up most.
          Check back soon.
        </p>
        <div style={{ marginTop: 22 }}>
          <Link
            href="/pickers"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "10px 18px",
              borderRadius: 12,
              border: "1px solid rgba(96,165,250,0.4)",
              background: "rgba(59,130,246,0.10)",
              color: "#dbeafe",
              textDecoration: "none",
              fontWeight: 800,
              fontSize: 13.5,
            }}
          >
            Explore the Stock Pickers →
          </Link>
        </div>
      </section>
    </Shell>
  );
}

export default async function PopularSearchesPage() {
  const unlocked = (await headers()).get("x-msh-ps-preview") === "1";
  if (!unlocked) return <ComingSoon />;

  const demand = await readSearchDemand(60);

  let nameMap = new Map<string, string>();
  try {
    nameMap = await getCompanyNameMap();
  } catch {
    // names are optional
  }

  return (
    <Shell>
      <section
        style={{
          border: "1px solid rgba(96,165,250,0.18)",
          borderRadius: 24,
          padding: 24,
          background: "linear-gradient(180deg, rgba(10,16,32,0.96), rgba(6,10,18,0.98))",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 11px",
            borderRadius: 999,
            border: "1px solid rgba(250,204,21,0.32)",
            background: "rgba(250,204,21,0.10)",
            color: "#fde68a",
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Preview · not yet public
        </div>
        <h1 style={{ margin: "12px 0 0", fontSize: 40, lineHeight: 1.05, letterSpacing: "-0.045em" }}>
          Popular Searches
        </h1>
        <p style={{ margin: "10px 0 0", maxWidth: 720, fontSize: 15.5, lineHeight: 1.65, color: "rgba(226,232,240,0.76)" }}>
          The tickers MyStockHarbor visitors have searched for most over the last{" "}
          {SEARCH_DEMAND_WINDOW_DAYS} days. Counts come only from real, deliberate ticker
          selections — not page views or bots.
        </p>
      </section>

      {demand.length === 0 ? (
        <div
          style={{
            marginTop: 18,
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 18,
            padding: 20,
            background: "rgba(255,255,255,0.035)",
            color: "rgba(226,232,240,0.72)",
            lineHeight: 1.7,
          }}
        >
          No search activity recorded in the last {SEARCH_DEMAND_WINDOW_DAYS} days yet. As visitors
          search tickers across the site, the most-searched names will appear here.
        </div>
      ) : (
        <div style={{ marginTop: 18, display: "grid", gap: 8 }}>
          {demand.map((row, index) => {
            const name = nameMap.get(row.symbol);
            const searches = Math.round(row.score);
            return (
              <Link
                key={row.symbol}
                href={`/stock/${encodeURIComponent(row.symbol)}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "13px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.09)",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span
                  style={{
                    flex: "0 0 auto",
                    width: 30,
                    textAlign: "right",
                    fontSize: 15,
                    fontWeight: 900,
                    color: index < 3 ? "#facc15" : "rgba(148,163,184,0.7)",
                  }}
                >
                  {index + 1}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 16, fontWeight: 900, color: "#eaf2ff" }}>{row.symbol}</span>
                  {name ? (
                    <span
                      style={{
                        marginLeft: 10,
                        fontSize: 13,
                        color: "rgba(148,163,184,0.9)",
                        fontWeight: 600,
                      }}
                    >
                      {name}
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    flex: "0 0 auto",
                    fontSize: 13,
                    fontWeight: 800,
                    color: "rgba(147,197,253,0.92)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {searches.toLocaleString("en-US")} search{searches === 1 ? "" : "es"}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
