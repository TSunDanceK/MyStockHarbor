function toChartHref(href: string, symbol?: string) {
  const cleanedSymbol = String(symbol || "").trim().toUpperCase();
  const fallback = cleanedSymbol
    ? `/dashboard?symbol=${encodeURIComponent(cleanedSymbol)}`
    : "/dashboard";
  const raw = href && href.trim() ? href.trim() : "";

  // Rewrite legacy /?symbol= links to /dashboard?symbol=
  const normalised = raw.startsWith("/?symbol=")
    ? raw.replace("/?symbol=", "/dashboard?symbol=")
    : raw.startsWith("/?")
    ? raw.replace("/?", "/dashboard?")
    : raw;

  const base = normalised.startsWith("/dashboard") ? normalised : fallback;
  return base.includes("#chart") ? base : `${base}#chart`;
}