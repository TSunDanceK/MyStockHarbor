import { redirect } from "next/navigation";

// There's no general "all tickers" news feed - AI-scored headlines are
// generated per symbol (see app/stock/[symbol]/news). Previously /news had
// no route at all and 404'd whenever someone clicked "News" in the top nav
// without already having a ticker in context. Default to a high-profile,
// always-active ticker so the link always resolves to something useful.
export default function NewsIndexRedirect() {
  redirect("/stock/TSLA/news");
}
