// WHY A RE-READ LEFT A STALE COVER STORED (#552 COWORK #218 item 2: Visa),
// and, since #552 COWORK #222, what the shipped decision now does with it.
// READS ONLY, despite the write- task prefix (the store read needs the credential).
// Redis: 1 GET of the manifest, then 1 GET (the stored fact set) per symbol. No writes:
// withClassCover's review-row calls are gated by canWriteSecState(), which is
// false off a production deployment, and nothing here calls writeFactSet.
//
// Replays the sec-facts job's per-symbol path with the SHIPPED modules, in the
// route's order (companyfacts -> extractForSymbol -> withClassCover ->
// withInstanceEps -> toStoredSet), then the route's own write decision
// (keepFilled / keepNotice / priorStandsForFx / keptWithNewer / mustWriteOver)
// against the stored set, and prints which term decided it, whether the kept
// set takes a newer cover or te, and whether verifiedAt is stamped.
// Default symbols: every cited share-classes.json entry (V and the rest).
// withClassCover swallows a failed read (console.warn, then the extractor's
// cover); those warnings are captured per symbol and printed as the "fetch
// failure" term.
//   relay task: write-stale-cover-replay   SYMBOLS="V" (optional)
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const { extractForSymbol } = await import("../lib/server/secExtractFor.ts");
const { withPredecessorFacts } = await import("../lib/server/secSuccession.ts");
const { withClassCover } = await import("../lib/server/secCoverClasses.ts");
const { withInstanceEps } = await import("../lib/server/secInstanceEps.ts");
const { toStoredSet, mustWriteOver, conversionGained, priorStandsForFx, keptWithNewer } = await import("../lib/server/secFactBuild.ts");
const { newestStoredEnd } = await import("../lib/server/secFilingFill.ts");
const { needsReread, staleReasons } = await import("../lib/server/secStaleness.ts");
const { secFieldsHash } = await import("../lib/server/secFields.ts");
const { defaultSources } = await import("../lib/server/fxRates.ts");

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; stale cover replay)";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const REREAD = JSON.parse(fs.readFileSync("data/sec/reread-requests.json", "utf8")).requests;
const MAP = JSON.parse(fs.readFileSync("data/sec/share-classes.json", "utf8")).entries;
// THE SWALLOWED FAILURES, captured rather than lost.
let warned = [];
const warn = console.warn.bind(console);
console.warn = (...a) => {
  warned.push(a.map((x) => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  warn(...a);
};
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
let gets = 0;
// ≤ 8 requests/s, one at a time.
const get = async (u) => {
  await new Promise((x) => setTimeout(x, 130));
  gets++;
  const res = await fetch(u, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${u.replace(/^https:\/\/[^/]+/, "")}`);
  return res;
};
const facts = async (cik) => (await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`)).json();
const iso = (t) => (typeof t === "number" ? new Date(t).toISOString().slice(0, 19) + "Z" : String(t ?? null));
const stamps = (o) => JSON.stringify({ w: o?.w ?? null, y: o?.y ?? null, lv: o?.lv ?? null, sv: o?.sv ?? null, c: o?.c ?? null });
const coverStr = (c) => (c ? `${c.val} as of ${c.asOf} (${c.derived}${c.accession ? `, ${c.accession}` : ""})` : "null");
const teStr = (t) => (t ? `${t.val} to ${t.periodEnd} (${t.kind})` : "none");

let commands = 1;
const MANIFEST = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
const summary = [];
const alt = (s) => (s.includes(".") ? s.replace(".", "-") : s.replace("-", "."));
for (const s of (process.env.SYMBOLS || Object.keys(MAP).join(",")).split(/[,\s]+/).filter(Boolean)) {
  console.log(`\n== ${s}`);
  warned = [];
  const req = REREAD.filter((r) => r.symbol === s || r.symbol === alt(s)).at(-1);
  console.log(`  re-read request: ${req ? req.requestedAt : "none"}`);
  // THE DOT/DASH SPELLINGS (#740): a set may be stored under either.
  let prior = await redis.get(`${FACTS}:${s}`); commands++;
  if (!prior && alt(s) !== s) { prior = await redis.get(`${FACTS}:${alt(s)}`); commands++; }
  const me = MANIFEST?.symbols?.[s] ?? MANIFEST?.symbols?.[alt(s)] ?? null;
  console.log(`  manifest: verifiedAt ${iso(me?.verifiedAt)}; needsReverify ${me?.needsReverify ?? null}; stamps ${stamps(me)}; contentHash ${me?.contentHash ?? null}`);
  if (!prior) { console.log("  no stored set"); summary.push(`${s}: no stored set`); continue; }
  console.log(`  stored set: extracted ${iso(prior.at)}; fields hash ${prior.h === secFieldsHash() ? "current" : "STALE"}; contentHash ${prior.contentHash}`);
  console.log(`  stored stamps ${stamps(prior)}; needsReread ${needsReread(prior)} ${JSON.stringify(staleReasons(prior))}`);
  console.log(`  stored newest end ${newestStoredEnd(prior)}; ff ${JSON.stringify(prior.ff ?? null)}; lg ${JSON.stringify(prior.lg ?? null)}`);
  console.log(`  stored cover ${coverStr(prior.cover)}; te ${teStr(prior.te)}`);

  const cik = String(REG[s]?.cik ?? REG[alt(s)]?.cik ?? "").padStart(10, "0");
  let extracted, fresh;
  try {
    const f = await withPredecessorFacts(cik, await facts(cik), facts);
    extracted = extractForSymbol(s, f);
    const extractorCover = extracted.coverShares;
    extracted.coverShares = await withClassCover(s, cik, extracted.coverShares, get);
    extracted.ttmEps = await withInstanceEps(s, cik, extracted, get);
    fresh = await toStoredSet(extracted, defaultSources(), new Map());
    console.log(`  fresh: extractor cover ${coverStr(extractorCover)} -> withClassCover ${coverStr(extracted.coverShares)}`);
    console.log(`  fresh: te ${teStr(fresh.te)}; newest end ${newestStoredEnd(fresh)}; contentHash ${fresh.contentHash}; stamps ${stamps(fresh)}`);
  } catch (e) {
    console.log(`  fresh read FAILED: ${e?.message ?? e}`);
    summary.push(`${s}: fresh read failed (${e?.message ?? e})`);
    continue;
  }

  // THE ROUTE'S DECISION, line for line (app/api/jobs/sec-facts/route.ts).
  const freshNewest = newestStoredEnd(fresh) ?? "";
  const keepFilled = Boolean(prior?.ff && freshNewest < prior.ff.reportDate);
  const keepNotice = Boolean(prior?.lg && freshNewest < prior.lg.reportDate);
  const keepForFx = priorStandsForFx(prior, extracted, fresh);
  const keepPrior = keepFilled || keepForFx;
  const kept = keepPrior ? keptWithNewer(prior, fresh, new Date().toISOString().slice(0, 10)) : null;
  const set = keepPrior ? kept : keepNotice ? { ...fresh, lg: prior.lg } : fresh;
  const hashMoved = prior.contentHash !== set.contentHash;
  const changed = keepPrior ? kept !== prior : mustWriteOver(prior, set);
  const stamped = !keepPrior;
  console.log(`  decision: keepFilled ${keepFilled} (fresh newest ${freshNewest || "none"} vs ff ${prior.ff?.reportDate ?? "none"}); keepNotice ${keepNotice}; keepForFx ${keepForFx}`);
  console.log(`  decision: hash moved ${hashMoved}; conversionGained ${conversionGained(prior, set)}; needsReread(prior) ${needsReread(prior)} -> changed ${changed}`);
  if (keepPrior) console.log(`  kept set: ${kept === prior ? "kept as it is" : `MERGED (cover ${coverStr(kept.cover)}; te ${teStr(kept.te)})`}`);
  console.log(`  => ${changed ? "WRITTEN" : "NOT WRITTEN"}; verifiedAt ${stamped ? "stamped" : "NOT stamped (the request stays open; keptOpen recorded)"}`);
  const coverWarn = warned.filter((w) => w.includes("[sec-cover-classes]"));
  if (coverWarn.length) console.log(`  withClassCover warnings: ${coverWarn.join(" | ")}`);
  const differs = (prior.cover?.val ?? null) !== (extracted.coverShares?.val ?? null) || (prior.cover?.asOf ?? null) !== (extracted.coverShares?.asOf ?? null);
  const term = `${keepFilled ? "keepFilled" : keepForFx ? "keepForFx" : "read through"}${keepPrior ? (kept === prior ? ", kept as is" : ", merged") : ""}; ${changed ? "written" : "not written"}; ${stamped ? "stamped" : "not stamped"}${coverWarn.length ? "; cover needs review" : ""}`;
  summary.push(`${s}: stored cover ${differs ? "DIFFERS from" : "equals"} today's (${coverStr(prior.cover)} vs ${coverStr(extracted.coverShares)}); ${term}; extracted ${iso(prior.at)}; verifiedAt ${iso(me?.verifiedAt)}`);
}
console.log(`\n== SUMMARY\n${summary.map((x) => `  ${x}`).join("\n")}`);
console.log(`\nRedis commands used by this read: ${commands}; SEC requests: ${gets}`);
