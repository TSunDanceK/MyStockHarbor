import Link from "next/link";
import type { Metadata } from "next";
import { readStoredReceivers, receiverRows } from "@/lib/server/capexReceivers";
import { receiverEntries } from "@/lib/server/capexReceiverList";
import ReceiversPanel from "./ReceiversPanel";

// "Capex — Follow the money" (#563). PHASE 1, IN PROGRESS: this PR ships only
// the "Who is receiving" panel so it can be previewed. The page shell, the nav
// entry and the other panels follow in their own PRs; until then the page is
// noindex and linked from nowhere.

export const metadata: Metadata = {
  title: "Capex — Follow the money | MyStockHarbor",
  description:
    "Where companies are putting their money, from filed figures only: who is spending on capital projects, and which filed revenue lines are growing.",
  robots: { index: false, follow: false },
};

// The receivers record changes at most once a day (the capex-receivers job),
// so an hourly re-render is one Redis GET an hour.
export const revalidate = 3600;

export default async function CapexPage() {
  const stored = await readStoredReceivers();
  const rows = receiverRows(receiverEntries(), stored);
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
        padding: "40px 20px",
        overflowX: "hidden",
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <Link href="/bottlenecks" style={{ color: "#93c5fd", textDecoration: "none", fontWeight: 700, fontSize: 14 }}>
          ← Back to Bottlenecks
        </Link>
        <h1 style={{ fontSize: 34, lineHeight: 1.1, fontWeight: 900, margin: "20px 0 8px" }}>
          Capex — Follow the money
        </h1>
        <ReceiversPanel rows={rows} />
      </div>
    </main>
  );
}
