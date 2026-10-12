// A RATE FILER'S PICKERS DIVIDEND CELLS, BEFORE AND AFTER (#553 COWORK #210).
// READ-ONLY, ENFORCED (GET, MGET, HMGET, EXISTS).
//
// For each named symbol, three states of Div ($), Div Growth and Payout:
//   live     the stored picker row production serves now (built by the last
//            warm-pickers-sec run, before A's #848);
//   #848     main as merged: A's withholding, no rate pass (the PR's module
//            with dividendRateRead switched off);
//   PR       this branch: the latest filed rate x 4, marked.
// Plus the newest eight stored quarters' declared DPS with their codes
// (F filed, D differenced, W withheld after A's pass).
//
// PUBLIC LOG: symbols, filed DPS, ratios and period labels. No price: the yield
// is reported only as shown or not.
//
//   node scripts/dividend-rate-trace.mjs   (relay: write-dividend-rate-trace)
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "MGET", "HMGET", "EXISTS"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    if (!cmds.length) throw new Error("read-only: refused a request with no readable command");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};

const ROOT = process.cwd();
const MODULE = "lib/server/pickersSecFundamentals.ts";
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const { readFactSet } = await import("../lib/server/secFactStore.ts");
const { cell } = await import("../lib/server/secFactCodec.ts");
const { splitAdjusted } = await import("../lib/server/secSplitAdjust.ts");
const PR = await import("../lib/server/pickersSecFundamentals.ts");
// #848 alone: the same module with the rate pass switched off.
const src = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
const ANCHOR = "if (!set.dvr?.rate) return null;";
if (!src.includes(ANCHOR)) { console.error("FATAL: rate-pass anchor not found"); process.exit(2); }
const sib = path.join(ROOT, "lib/server", `.trace-848-${process.pid}.ts`);
fs.writeFileSync(sib, src.replace(ANCHOR, "return null;"));
let ONLY848;
try { ONLY848 = await import(pathToFileURL(sib).href); } finally { fs.unlinkSync(sib); }

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const usd = (v) => (v === null || v === undefined ? "–" : `$${v.toFixed(4)}`);
const pct = (v) => (v === null || v === undefined ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const today = new Date().toISOString().slice(0, 10);
const NAMED = (process.env.NAMED || "BKNG CEG V").split(/\s+/);
const stored = await redis.hmget(PR.PICKERS_SEC_KEY, ...NAMED);

const describe = (mod, row) => {
  const f = mod.applySecPickerRow(row, 100);
  const e = mod.applySecEarnings(row, 100);
  const pay = e?.payoutRatio != null ? `${e.payoutRatio.toFixed(1)}% (${e.payoutBasis})` : `– (${e?.payoutBasis ?? "no basis"})`;
  const marks = Object.keys({ ...(f.marks ?? {}), ...(mod.payoutRateMark?.(row, e) ? { payout: 1 } : {}) }).filter((k) => k !== "ev" && k !== "pb");
  return `Div ${usd(f.divPerShare)} · yield ${f.divYield === null ? "–" : "shown"} · growth ${pct(f.divGrowth)} · payout ${pay}${marks.length ? ` · ≈ on ${marks.join(", ")}` : ""}`;
};

for (const s of NAMED) {
  console.log(`\n== ${s}`);
  const live = parse(stored?.[s] ?? null);
  console.log(`  live  ${live ? `${describe(PR, live)} · built ${new Date(live.at).toISOString().slice(0, 16)}Z` : "no stored row"}`);
  const set = await readFactSet(s);
  if (!set) { console.log("  no fact set"); continue; }
  const adj = splitAdjusted(set);
  const code = (p) => { const c = cell(p, "dividendsDeclaredPerShare"); return c.val === null ? (c.derived === "withheld" ? "W" : "–") : `${(c.derived === "differenced" ? "D" : "F")} ${c.val}`; };
  console.log(`  dvr   ${JSON.stringify(adj.dvr ?? null)}`);
  console.log(`  DPS   ${adj.quarters.slice(0, 8).map((p) => `${p.fp} FY${p.fy}:${code(p)}`).join(" · ")}`);
  const a = ONLY848.buildSecPickerRow(set, today, { annualForm: "10-K" }, Date.now());
  console.log(`  #848  ${describe(ONLY848, JSON.parse(JSON.stringify(a)))}`);
  const b = PR.buildSecPickerRow(set, today, { annualForm: "10-K" }, Date.now());
  console.log(`  PR    ${describe(PR, JSON.parse(JSON.stringify(b)))} · rate ${b.div?.rate ? `${b.div.rate.q} (quarter to ${b.div.rate.end})` : "none"}`);
}
console.log(`\nRedis commands ${commands} (read-only)`);
