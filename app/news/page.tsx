import { redirect } from "next/navigation";

// General market news landing. Previously redirected to a single ticker's
// news page (/stock/TSLA/news) because there was no general "all tickers"
// feed yet - that meant anyone clicking "News" without a ticker in context
// landed on a single noindexed stock page. /headlines (added later) is a
// proper general market headlines feed - plain FMP headlines, no AI - and
// is itself indexable, so redirect here instead.
export default function NewsIndexRedirect() {
  redirect("/headlines");
}
