// Read-only: print one cached daily-history entry as JSON, for a local
// screenshot fixture (Relay B, #553 COWORK #27 -- the preview's bypass secret is
// not set, so the dashboard is rendered locally against this data).
//   relay task: write-history-key-dump  (SYMBOLS = one ticker)  Redis: 1 GET.
import { Redis } from "@upstash/redis";
const sym = String(process.env.SYMBOLS || "AAPL").trim().toUpperCase();
if (!/^[A-Z.\-]{1,10}$/.test(sym)) throw new Error("one ticker only");
const v = await Redis.fromEnv().get(`msh:history:v7:${sym}`);
console.log(`HISTORY-JSON ${JSON.stringify(v)}`);
