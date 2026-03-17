import React from "react";

type Props = {
  params: { symbol: string };
};

export default function StockPage({ params }: Props) {
  const symbol = params.symbol.toUpperCase();

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
        <h1>{symbol} Stock Page</h1>

        <p>This will become the full SEO stock analysis page.</p>
      </div>

      <style>{`
        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 28px 20px 40px;
        }
      `}</style>
    </main>
  );
}
