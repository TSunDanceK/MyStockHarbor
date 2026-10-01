// READ-ONLY, NO CREDENTIALS: does each Pickers page on production carry the
// per-surface Tiingo credit (#553 COWORK #71/#81)? Prints presence only.
//
//   node scripts/pickers-footer-check.mjs
const SITE = "https://www.mystockharbor.com";
const PAGES = ["/pickers", "/low-pe-stocks", "/oversold-stocks-today"];
const CREDIT = "Market data from Tiingo.com";
let missing = 0;
for (const p of PAGES) {
  try {
    const res = await fetch(SITE + p, { headers: { "user-agent": "msh-relay-footer-check" } });
    const html = await res.text();
    const has = html.includes(CREDIT);
    if (!has) missing++;
    const age = res.headers.get("age");
    console.log(`${p}: HTTP ${res.status}; credit ${has ? "present" : "ABSENT"}; x-vercel-cache ${res.headers.get("x-vercel-cache") ?? "-"}; age ${age ?? "-"} s`);
  } catch (err) {
    missing++;
    console.log(`${p}: fetch failed (${err instanceof Error ? err.message : "error"})`);
  }
}
console.log(missing ? `${missing} page(s) without the credit` : "credit present on every page checked");
