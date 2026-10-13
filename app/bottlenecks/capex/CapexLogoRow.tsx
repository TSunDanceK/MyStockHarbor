// ONE ROW OF THE CAPEX SIDEBAR'S COMPANY CARDS (#563 COWORK #130): "Who is
// spending most" and "Who is receiving most". The company's logo sits beside
// its ticker: the /bottlenecks hub leaderboard's own TickerLogo at its row size
// (30 px, radius 8), so the stored logo, or the letter tile when there is none.
// Nothing new is fetched to draw it.
//
// The ticker line is one logo tall, so the logo is centred on it; the amount
// shares that line, right-aligned; a second line (the receiving card's sales
// line) sits under the ticker, never under the logo.
// scripts/check-capex-receiving.mjs holds every row to a logo or its letter.
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";

export const CAPEX_LOGO_PX = 30;

export default function CapexLogoRow({ ticker, name, amount, sub, style, nameStyle }: {
  ticker: string;
  name: string;
  amount: ReactNode;
  /** A second line under the ticker (the receiving card's "line · FY to"). */
  sub?: ReactNode;
  style?: CSSProperties;
  nameStyle?: CSSProperties;
}) {
  return (
    <li className="capexLogoRow" data-ticker={ticker} style={{ ...rowStyle, ...style }}>
      <TickerLogo symbol={ticker} name={name} size={CAPEX_LOGO_PX} radius={8} alt="" />
      <span style={{ minWidth: 0 }}>
        <span style={lineStyle}>
          <Link href={`/stock/${encodeURIComponent(ticker)}`}>{ticker}</Link>
          <span className="cardName" style={nameStyle}>{name}</span>
        </span>
        {sub}
      </span>
      <span className="cardAmt" style={lineStyle}>{amount}</span>
    </li>
  );
}

const rowStyle: CSSProperties = { gridTemplateColumns: `${CAPEX_LOGO_PX}px minmax(0, 1fr) auto`, alignItems: "start" };
/** One logo tall, or taller when a large text setting needs it. */
const lineStyle: CSSProperties = { display: "block", lineHeight: `max(${CAPEX_LOGO_PX}px, 1.5em)` };
