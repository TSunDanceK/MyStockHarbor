import Link from "next/link";

import { getInsightsForSymbol } from "@/lib/blog";
import { dayWords } from "@/lib/insightView";

// The stock page's compact "Insights" list (#553): this ticker's insight posts,
// newest first, title and date, read from content/insights when the page is
// built. Renders nothing for a ticker with no posts, so it adds no empty block.
const SHOWN = 5;

export default function StockInsights({ symbol }: { symbol: string }) {
  const posts = getInsightsForSymbol(symbol);
  if (!posts.length) return null;
  const shown = posts.slice(0, SHOWN);
  return (
    <section aria-label={`${symbol} insights`} data-stock-insights="" style={{ maxWidth: 1100, margin: "24px auto 0", padding: "0 16px" }}>
      <h2 style={{ margin: "0 0 8px", fontSize: "1.125rem", fontWeight: 900, color: "#f1f5f9" }}>Insights on {symbol}</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {shown.map((post) => (
          <li key={post.slug} style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline" }}>
            <Link href={`/insights/${post.slug}`} style={{ color: "#93c5fd", fontWeight: 700, textDecoration: "none" }}>{post.title}</Link>
            <span style={{ fontSize: 13, color: "rgba(203,213,225,0.7)" }}>{dayWords(post.date)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
