import Link from "next/link";

export default function TradingSetupsPage() {
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
        <h1 style={{ margin: 0, fontSize: 34 }}>
          Trading Setups
        </h1>

        <p style={{ marginTop: 10, opacity: 0.75, maxWidth: 720 }}>
          Trading setups help traders identify opportunities in the stock market.
          Learn common setups like breakouts, oversold reversals, buy-the-dip
          opportunities and divergence signals.
        </p>

        <div className="grid">
          <SetupCard
            href="/breakout-stocks"
            title="Breakout Stocks"
            desc="Stocks pushing above resistance with strong momentum."
          />

          <SetupCard
            href="/oversold-stocks"
            title="Oversold Stocks"
            desc="Stocks that may be stretched to the downside."
          />

          <SetupCard
            href="/overbought-stocks"
            title="Overbought Stocks"
            desc="Stocks that may be stretched after strong upside moves."
          />

          <SetupCard
            href="/buy-the-dip-stocks"
            title="Buy The Dip"
            desc="Pullback opportunities within strong trends."
          />

          <SetupCard
            href="/stocks-down-from-highs"
            title="Stocks Down From Highs"
            desc="Stocks that have pulled back significantly from recent highs."
          />

          <SetupCard
            href="/bullish-divergence-stocks"
            title="Bullish Divergence"
            desc="When momentum improves even as price falls."
          />

          <SetupCard
            href="/bearish-divergence-stocks"
            title="Bearish Divergence"
            desc="When momentum weakens during rising prices."
          />
        </div>
      </div>

      <style>{`
        .wrap {
          max-width: 1000px;
          margin: 0 auto;
          padding: 24px;
        }

        .grid {
          margin-top: 24px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 14px;
        }
      `}</style>
    </main>
  );
}

function SetupCard({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      style={{
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 14,
        padding: 16,
        background: "rgba(255,255,255,0.05)",
        textDecoration: "none",
        color: "#f1f5f9",
        display: "block",
      }}
    >
      <div style={{ fontWeight: 900 }}>{title}</div>

      <div
        style={{
          marginTop: 6,
          fontSize: 13,
          opacity: 0.75,
          lineHeight: 1.5,
        }}
      >
        {desc}
      </div>
    </Link>
  );
}
