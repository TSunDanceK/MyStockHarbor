// "WHY FOLLOW THE MONEY?" (#563 COWORK #110): the capex page's one explanation
// card, directly under "Where the money is going" in the sidebar (and so right
// after it in the stacked order on a phone). The short result up front at
// reading size; how to use the page behind a tap; fine print last.
//
// COPY RULES: hedged ("may"), standard terms, no buy/sell/should, and NO NUMBERS
// of its own: the card explains the page, it reports nothing.
// scripts/check-capex-why.mjs pins the copy, the placement and the sizes.
import type { CSSProperties } from "react";

export const WHY_LINES = [
  "Capital spending (capex) is a company's bet on future demand. When the biggest spenders raise it, the businesses that sell to them may see it in their own sales.",
  "Capex is filed every year, so it can give an early, factual view of where an industry's money is flowing.",
  "It cuts both ways: heavy spending may lift suppliers' sales while weighing on the spender's free cash flow.",
] as const;

/** "How to use this page": [lead in bold, the rest]. */
export const HOW_STEPS: readonly (readonly [string, string])[] = [
  ["Start with Who is spending:", " which sectors raised capex the most since the first year shown, and how much of each sales dollar goes back into spending (capex as a share of revenue)."],
  ["Then Who is receiving:", " look for suppliers' sales lines growing at the same time. \"Broad line\" means the line also includes sales outside data centres."],
  ["Use Federal contracts", " as a separate view of where government money goes."],
  ["Open a company's stock page", " to check its own figures, chart and earnings before drawing any conclusion."],
  ["The three panels are not linked.", " A supplier's growth does not show that it sells to any particular spender, and annual figures look backward."],
];

export const WHY_FINE = "Filed and published figures only. Not a forecast or a recommendation.";

export default function WhyFollowMoney() {
  return (
    <section className="capexCard capexWhy">
      {/* rem, not the page's px (the sibling cards' sizes): this card scales with the reader's text setting. */}
      <div className="cardEyebrow" style={{ fontSize: "var(--fs-fine)" }}>Why it matters</div>
      <h3 style={{ fontSize: "1.125rem" }}>Why follow the money?</h3>
      {WHY_LINES.map((t) => <p key={t} style={readStyle}>{t}</p>)}
      <details className="capexWhyHow" style={{ marginTop: 10 }}>
        <summary style={summaryStyle}>How to use this page</summary>
        <ol style={{ ...readStyle, paddingLeft: 22 }}>
          {HOW_STEPS.map(([lead, rest]) => <li key={lead} style={{ marginTop: 4 }}><strong style={{ color: "#f8fafc" }}>{lead}</strong>{rest}</li>)}
        </ol>
      </details>
      <p data-fine-print style={fineStyle}>{WHY_FINE}</p>
    </section>
  );
}

const readStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(241,245,249,0.82)" };
const summaryStyle: CSSProperties = { cursor: "pointer", fontSize: "var(--fs-read)", fontWeight: 800, color: "#93c5fd" };
const fineStyle: CSSProperties = { margin: "10px 0 0 0", fontSize: "var(--fs-fine)", lineHeight: 1.5, color: "rgba(241,245,249,0.5)" };
