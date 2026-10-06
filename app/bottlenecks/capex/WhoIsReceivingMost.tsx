// "WHO IS RECEIVING MOST" (#563 COWORK #124): the sidebar card directly under
// "Who is spending most", in the same row style (ticker, company, amount). Its
// five rows are panel 2's own lines, picked by buildTopReceivers in
// lib/capexPresent.ts: supplier groups only, no broad or new lines, USD only.
//
// COPY RULES: describes, never advises; nothing estimates who pays whom.
// Sizes in rem or the tokens (the sibling cards' px stay theirs).
// scripts/check-capex-receiving.mjs pins the rows, the placement and the sizes.
import type { CSSProperties } from "react";
import Link from "next/link";
import type { TopReceiverView } from "@/lib/capexPresent";

export const RECEIVING_FINE =
  "From each company's latest annual report. Fiscal years end in different months. These are what suppliers sold, not a record of who paid them.";

export default function WhoIsReceivingMost({ rows }: { rows: TopReceiverView[] }) {
  if (!rows.length) return null;
  return (
    <section className="capexCard capexReceivingMost">
      <div className="cardEyebrow" style={{ fontSize: "var(--fs-fine)" }}>Who is receiving most</div>
      <h3 style={{ fontSize: "1.125rem" }}>Largest build-out sales lines</h3>
      <ul className="cardList">
        {rows.map((r) => (
          <li key={r.id} style={rowStyle}>
            <span style={{ minWidth: 0 }}>
              <Link href={`/stock/${encodeURIComponent(r.ticker)}`}>{r.ticker}</Link>
              <span className="cardName" style={{ fontSize: "var(--fs-label)" }}>{r.name}</span>
              <span style={lineStyle}>
                {r.line} · {r.fyTo}
                {r.stale ? " · earlier filing" : ""}
              </span>
            </span>
            <span className="cardAmt">{r.amount}</span>
          </li>
        ))}
      </ul>
      <p data-fine-print style={fineStyle}>{RECEIVING_FINE}</p>
    </section>
  );
}

const rowStyle: CSSProperties = { fontSize: "var(--fs-read)" };
const lineStyle: CSSProperties = { display: "block", marginTop: 2, fontSize: "var(--fs-label)", color: "rgba(241,245,249,0.6)" };
const fineStyle: CSSProperties = { margin: "10px 0 0 0", fontSize: "var(--fs-fine)", lineHeight: 1.5, color: "rgba(241,245,249,0.5)" };
