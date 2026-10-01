// DOES TIINGO CARRY THESE TICKERS? Count-only (#553 COWORK #83, C's pool-add list).
// One metadata request per symbol (GET /tiingo/daily/<SYM>). Prints the HTTP
// status, the exchange code and whether the latest date is recent. No price,
// no bar, no other market value (the logs are public).
//
//   relay task: tiingo-carries   (SYMBOLS=IFNNY,ASTS,...)
import { toTiingo } from "../lib/symbolSpellings.mjs";

const KEY = process.env.TIINGO_API_KEY ?? "";
if (!KEY) {
  console.error("FATAL: TIINGO_API_KEY is not set in this job. Refusing (nothing was requested).");
  process.exit(2);
}
const symbols = String(process.env.SYMBOLS || "IFNNY,ASTS,KRMN,LUNR,MOD").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 10);
let requests = 0;
for (const s of symbols) {
  requests++;
  try {
    const res = await fetch(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(toTiingo(s))}`, {
      headers: { Authorization: `Token ${KEY}`, "Content-Type": "application/json" },
    });
    if (!res.ok) { console.log(`${s}: NOT carried (HTTP ${res.status})`); continue; }
    const meta = await res.json();
    const end = String(meta?.endDate ?? "").slice(0, 10);
    const ageDays = end ? Math.round((Date.now() - Date.parse(end)) / 86_400_000) : null;
    console.log(`${s}: carried (HTTP 200); exchange ${meta?.exchangeCode ?? "?"}; latest date ${ageDays === null ? "none" : `${ageDays} day(s) old`}`);
  } catch (err) {
    console.log(`${s}: request failed (${err instanceof Error ? err.message.slice(0, 80) : "error"})`);
  }
}
console.log(`Tiingo requests: ${requests} (metadata only)`);
