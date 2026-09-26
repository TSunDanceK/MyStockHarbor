// Pickers: the STORED rows for the ADS filers, as the page reads them
// (Relay B, #553 COWORK #51). Side branch, never merge.
//
// Reads what warm-pickers-sec wrote (msh:pickers:sec-fundamentals:v1) and the
// price pool, applies the page's own read half (applySecPickerRow), and prints
// the share basis, refusals and market cap per symbol, plus the job's run
// record. Aggregate figures only.
//
//   relay task: write-pickers-stored-census
//   Redis: HMGET (rows) + HMGET (pool) + GET (run record) = 3 commands.
import "./lib/register-capex-ts.mjs";
import { Redis } from "@upstash/redis";

const SYMBOLS = (process.env.SYMBOLS || "TSM,ASML,AZN,BABA").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const P = await import("../lib/server/pickersSecFundamentals.ts");
const redis = Redis.fromEnv();
const pick = (res, i, k) => (Array.isArray(res) ? res[i] : res?.[k]) ?? null;
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const fmt = (v) => (v === null || v === undefined ? "—" : Math.abs(v) >= 1e6 ? `${(v / 1e9).toFixed(0)}B` : v.toFixed(2));

const rows = await redis.hmget(P.PICKERS_SEC_KEY, ...SYMBOLS);
const pool = await redis.hmget("msh:price-pool:v1", ...SYMBOLS);
const run = parse(await redis.get("msh:job-run:v1:warm-pickers-sec"));
const age = (ms) => (typeof ms === "number" ? `${((Date.now() - ms) / 3.6e6).toFixed(1)} h` : "?");
console.log(`warm-pickers-sec run record: ok ${run?.ok ?? "?"}; at ${run?.at ? new Date(run.at).toISOString() : "?"}; summary ${run?.summary ? JSON.stringify(run.summary) : "—"}`);
SYMBOLS.forEach((sym, i) => {
  const row = parse(pick(rows, i, sym));
  const p = parse(pick(pool, i, sym));
  const price = p && typeof p.price === "number" ? p.price : null;
  if (!row) { console.log(`${sym}: no stored row`); return; }
  const f = P.applySecPickerRow(row, price);
  const sh = row.inputs?.shares;
  console.log(`${sym}: stored ${age(row.at)} ago; unit ${row.unit}; shares basis ${sh ? (sh.adsRatio ? `ADS-equivalent (÷${sh.adsRatio})` : "ordinary") : "none"}; refusals [${(row.inputs?.refusals ?? []).join(", ")}]; market cap ${fmt(f.marketCap)}; P/S ${fmt(f.psRatio)}; P/B ${fmt(f.pbRatio)}`);
});
console.log("Redis commands: 3 (read-only)");
