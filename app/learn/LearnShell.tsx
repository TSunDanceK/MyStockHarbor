// app/learn/LearnShell.tsx
// Shared two-column shell for all /learn pages:
// sticky menu on the left, lesson content on the right.
// Collapses to a toggleable menu on mobile.

import Link from "next/link";
import { LESSONS } from "./lessons";

type GuideLink = { href: string; title: string };

const IN_DEPTH_GUIDES: GuideLink[] = [
  { href: "/how-to-read-stock-charts", title: "How to Read Stock Charts" },
  { href: "/best-stock-indicators-for-beginners", title: "Best Indicators for Beginners" },
  { href: "/trading-setups", title: "Trading Setups" },
];

const RISK_GUIDES: GuideLink[] = [
  { href: "/position-sizing-guide", title: "Position Sizing" },
  { href: "/stop-loss-strategy", title: "Stop Loss Strategy" },
  { href: "/trading-risk-management", title: "Trading Risk Management" },
  { href: "/risk-reward-ratio", title: "Risk–Reward Ratio" },
  { href: "/margin-trading-explained", title: "Margin Trading Explained" },
];

function groupLabelStyle(color: string): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 950,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color,
    padding: "14px 12px 6px",
  };
}

function NavGroup(props: {
  label: string;
  labelColor: string;
  items: { href: string; title: string }[];
  activeHref?: string;
}) {
  return (
    <div>
      <div style={groupLabelStyle(props.labelColor)}>{props.label}</div>
      <div style={{ display: "grid", gap: 2 }}>
        {props.items.map((it) => {
          const active = props.activeHref === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              style={{
                display: "block",
                padding: "8px 12px",
                borderRadius: 10,
                fontSize: 13.5,
                lineHeight: 1.35,
                textDecoration: "none",
                fontWeight: active ? 900 : 600,
                color: active ? "#dbeafe" : "rgba(226,232,240,0.78)",
                background: active
                  ? "linear-gradient(135deg, rgba(59,130,246,0.24), rgba(37,99,235,0.12))"
                  : "transparent",
                border: active
                  ? "1px solid rgba(59,130,246,0.4)"
                  : "1px solid transparent",
              }}
            >
              {it.title}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function LearnShell(props: {
  activeSlug?: string; // lesson slug, or undefined on the /learn index
  activeHref?: string; // explicit path for non-lesson pages (guides, risk pages)
  children: React.ReactNode;
}) {
  const { activeSlug, children } = props;
  const activeHref =
    props.activeHref ?? (activeSlug ? `/learn/${activeSlug}` : "/learn");

  const byCat = (cat: "Basics" | "Indicators" | "Divergencies") =>
    LESSONS.filter((l) => l.category === cat).map((l) => ({
      href: `/learn/${l.slug}`,
      title: l.title,
    }));

  const nav = (
    <nav aria-label="Learn menu" style={{ display: "grid", gap: 4 }}>
      <NavGroup
        label="Start here"
        labelColor="rgba(148,163,184,0.9)"
        items={[{ href: "/learn", title: "Learn Overview" }]}
        activeHref={activeHref}
      />
      <NavGroup
        label="Basics"
        labelColor="rgba(96,165,250,0.95)"
        items={byCat("Basics")}
        activeHref={activeHref}
      />
      <NavGroup
        label="Indicators"
        labelColor="rgba(52,211,153,0.95)"
        items={byCat("Indicators")}
        activeHref={activeHref}
      />
      <NavGroup
        label="Divergences"
        labelColor="rgba(251,191,36,0.95)"
        items={byCat("Divergencies")}
        activeHref={activeHref}
      />
      <NavGroup
        label="In-Depth Guides"
        labelColor="rgba(52,211,153,0.8)"
        items={IN_DEPTH_GUIDES}
        activeHref={activeHref}
      />
      <NavGroup
        label="Risk Management"
        labelColor="rgba(248,113,113,0.9)"
        items={RISK_GUIDES}
        activeHref={activeHref}
      />
    </nav>
  );

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
      <div className="learn-shell">
        {/* Mobile menu (collapsed by default) */}
        <details className="learn-nav-mobile">
          <summary>☰ Learn menu</summary>
          <div className="learn-nav-mobile-panel">{nav}</div>
        </details>

        {/* Desktop sidebar */}
        <aside className="learn-nav-desktop">
          <div className="learn-nav-sticky">{nav}</div>
        </aside>

        <div className="learn-content" style={{ minWidth: 0 }}>
          {children}
        </div>
      </div>

      <style>{`
        .learn-shell {
          max-width: 1240px;
          margin: 0 auto;
          padding: 24px;
          display: grid;
          grid-template-columns: 264px minmax(0, 1fr);
          gap: 28px;
          align-items: start;
        }
        .learn-nav-desktop {
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 16px;
          background: rgba(255,255,255,0.03);
          padding: 8px 8px 16px;
        }
        .learn-nav-sticky {
          position: sticky;
          top: 16px;
          max-height: calc(100vh - 32px);
          overflow-y: auto;
          scrollbar-width: thin;
        }
        .learn-nav-mobile { display: none; }
        a:hover { filter: brightness(1.08); }

        @media (max-width: 900px) {
          .learn-shell {
            grid-template-columns: 1fr;
            padding: 16px;
            gap: 16px;
          }
          .learn-nav-desktop { display: none; }
          .learn-nav-mobile {
            display: block;
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 14px;
            background: rgba(255,255,255,0.04);
            padding: 4px 8px;
          }
          .learn-nav-mobile summary {
            cursor: pointer;
            font-weight: 900;
            padding: 10px 6px;
            list-style: none;
          }
          .learn-nav-mobile summary::-webkit-details-marker { display: none; }
          .learn-nav-mobile-panel { padding: 0 4px 10px; }
        }
      `}</style>
    </main>
  );
}
