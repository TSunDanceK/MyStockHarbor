// THE INSIGHT CANDIDATES KEY (#553 COWORK #181, with #188).
//
// Runtime, on fixtures (lib/server/insightCandidates.ts):
//   1. events: a 5% gap, a 52-week closing high, a 200-day test, a volume
//      spike, results just reported / expected this week; none on a quiet day
//   2. ranked by size x event strength; only the top INSIGHT_UNIVERSE by cap
//   3. #188: no fact set, or no filed period, is left out (and recorded)
//   4. the read path drops a ticker posted within 30 days, keeps one at 30
//   5. buzz: the most-searched name of $10bn+ with an event
//   6. THE GUARD: the real value is clean; a number, a dollar figure or a
//      price-shaped field is flagged, and the write refuses a flagged value
// Source:
//   7. the tiingo-eod job writes it on a complete night only, never failing it.
// Every rule has a planted mutant.
//
//   node scripts/check-insight-candidates.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
const LIB = "lib/server/insightCandidates.ts";
const JOBS = "lib/server/marketData/jobs.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const tmp = [];
let seq = 0;
async function load(src) {
  const f = path.join(ROOT, "lib", "server", `.check-ic-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

// ── fixtures ──
const ASOF = "2026-10-05";
const dateAt = (i, n) => { const d = new Date(Date.parse(`${ASOF}T00:00:00Z`) - (n - 1 - i) * 86400000); return d.toISOString().slice(0, 10); };
// 300 quiet bars around 100 with a gentle wave (no 52w extreme on the last bar,
// no gap, steady volume, well clear of the 200-day line).
function quiet(n = 300) {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + 8 * Math.sin(i / 9);
    return [dateAt(i, n), c, c + 0.5, c - 0.5, c, 1e6];
  });
}
const withLast = (bars, f) => { const b = bars.map((x) => [...x]); f(b[b.length - 1], b); return b; };
const USD = { reporting: "USD", converted: false };
const row = (shares, eps = true) => ({ v: 1, unit: USD, at: 0, inputs: { shares: { val: shares, asOf: "2026-07-20" }, refusals: [] }, ...(eps ? { eps: { val: 5, basis: "four-quarters", periodEnd: "2026-06-30" } } : {}) });

function eventRules(C) {
  const fails = [];
  const want = (label, ok, d = "") => { if (!ok) fails.push(`${label}${d ? ` (${d})` : ""}`); };
  const q = quiet();
  const prev = q[q.length - 2][4];
  const quietEvents = C.eventsOf(q, null, ASOF);
  want("a quiet day has no event", quietEvents.length === 0, quietEvents.join());
  want("a 5% gap up", C.eventsOf(withLast(q, (b) => { b[1] = prev * 1.06; b[2] = prev * 1.07; b[3] = prev * 1.05; b[4] = prev * 1.06; }), null, ASOF).includes("gap-up"));
  want("a 4% gap is not one", !C.eventsOf(withLast(q, (b) => { b[1] = prev * 1.04; b[4] = prev * 1.04; }), null, ASOF).includes("gap-up"));
  want("a 52-week closing high", C.eventsOf(withLast(q, (b) => { b[1] = prev; b[2] = 130; b[4] = 129; }), null, ASOF).includes("high-52w"));
  want("a volume spike at 2x", C.eventsOf(withLast(q, (b) => { b[5] = 2.1e6; }), null, ASOF).includes("volume-spike"));
  const ma200 = q.slice(-200).reduce((s, b) => s + b[4], 0) / 200;
  want("a 200-day test (the low reaches the line, the close holds near it)", C.eventsOf(withLast(q, (b) => { b[1] = ma200 * 1.02; b[2] = ma200 * 1.03; b[3] = ma200 * 0.995; b[4] = ma200 * 1.01; }), null, ASOF).includes("ma200-test"));
  const rec = (announcedOn, next) => ({ symbol: "X", cik: "1", at: "", events: [{ announcedOn, periodEnd: "2026-06-30", accession: "a", basis: "8-K" }], nextPeriodEnd: null, next });
  want("results reported 2 days ago", C.eventsOf(q, rec("2026-10-03", null), ASOF).includes("results-reported"));
  want("results reported 10 days ago are not", !C.eventsOf(q, rec("2026-09-25", null), ASOF).includes("results-reported"));
  want("results expected in 4 days", C.eventsOf(q, rec("2026-07-20", { kind: "date", date: "2026-10-09" }), ASOF).includes("results-this-week"));
  want("strongest first", C.eventsOf(withLast(q, (b) => { b[5] = 3e6; b[1] = prev * 1.06; b[4] = prev * 1.06; }), null, ASOF)[0] === "gap-up");
  return fails;
}

function selectRules(C) {
  const fails = [];
  const want = (label, ok, d = "") => { if (!ok) fails.push(`${label}${d ? ` (${d})` : ""}`); };
  const q = quiet();
  const prev = q[q.length - 2][4];
  const gap = withLast(q, (b) => { b[1] = prev * 1.06; b[2] = prev * 1.07; b[3] = prev * 1.05; b[4] = prev * 1.06; });
  const vol = withLast(q, (b) => { b[5] = 2.5e6; });
  const bars = new Map([["MEGA", vol], ["BIG", gap], ["SMALL", gap], ["NOFACT", gap], ["NOEPS", gap], ["QUIET", q], ["BRK-B", gap]]);
  const close = gap[gap.length - 1][4];
  const secRows = {
    MEGA: row(3e10 / close * 100), // ~3tn at vol's close, the weakest event
    BIG: row(1e9),                 // ~$106bn, the strongest event
    SMALL: row(1e7),               // ~$1bn
    NOEPS: row(1e9, false),
    QUIET: row(5e9),
    "BRK.B": row(2e9),             // dotted field, dashed bars
  };
  const value = C.selectInsightCandidates({ asOf: ASOF, bars, secRows, reportDates: new Map(), demand: [{ symbol: "SMALL", score: 99 }, { symbol: "BIG", score: 50 }] }, "t");
  const syms = value.ranked.map((c) => c.symbol);
  want("a quiet stock is not a candidate", !syms.includes("QUIET"));
  want("size x strength: a $100bn gap outranks a $3tn volume spike; the dotted field ranks dashed", syms.join() === "BRK-B,BIG,MEGA,SMALL" || syms.join() === "BIG,BRK-B,MEGA,SMALL", syms.join());
  want("#188: no fact set is not ranked (it has no row, so no cap either)", !syms.includes("NOFACT"));
  want("#188: no filed period is left out, recorded", !syms.includes("NOEPS") && value.excluded.some((e) => e.symbol === "NOEPS" && e.why === "no-filed-period"), JSON.stringify(value.excluded));
  want("the cap bucket", value.ranked.find((c) => c.symbol === "MEGA")?.capBucket === "mega" && value.ranked.find((c) => c.symbol === "SMALL")?.capBucket === "mid");
  want("buzz: the most-searched $10bn+ name with an event (SMALL is under $10bn)", value.buzz?.symbol === "BIG" && value.buzz?.buzz === true, value.buzz?.symbol);
  want("the reason is words", /^Gapped up 5% or more at the open/.test(value.ranked.find((c) => c.symbol === "BIG")?.reason ?? ""));
  // Only the top INSIGHT_UNIVERSE by cap: 300 large names with a weak event,
  // and 5 just below the cut with a strong one, which would outrank them.
  const many = new Map(), manyRows = {};
  for (let i = 0; i < C.INSIGHT_UNIVERSE; i++) { const s = `S${String(i).padStart(3, "0")}`; many.set(s, vol); manyRows[s] = row(1e9 - i * 1e5); }
  for (let i = 0; i < 5; i++) { const s = `T${i}`; many.set(s, gap); manyRows[s] = row(5e8 - i * 1e5); }
  const v2 = C.selectInsightCandidates({ asOf: ASOF, bars: many, secRows: manyRows, reportDates: new Map(), demand: [] }, "t");
  want("only the top INSIGHT_UNIVERSE by cap", v2.ranked.length === C.INSIGHT_RANKED_KEEP && !v2.ranked.some((c) => c.symbol.startsWith("T")), v2.ranked.slice(0, 3).map((c) => c.symbol).join());
  return { fails, value };
}

function readRules(C, value) {
  const fails = [];
  const want = (label, ok, d = "") => { if (!ok) fails.push(`${label}${d ? ` (${d})` : ""}`); };
  const posted = (sym, daysAgo) => ({ symbol: sym, date: new Date(Date.parse(`${ASOF}T00:00:00Z`) - daysAgo * 86400000).toISOString().slice(0, 10) });
  const out = C.finalInsightCandidates(value, [posted("BIG", 29), posted("MEGA", 30), posted("brk.b", 3)]);
  const syms = out.candidates.map((c) => c.symbol);
  want("posted 29 days ago: left out", !syms.includes("BIG") && out.repeats.includes("BIG"));
  want("posted 30 days ago: back in", syms.includes("MEGA"));
  want("a post's spelling does not matter (brk.b)", !syms.includes("BRK-B"));
  want("the buzz pick obeys the same rule", out.buzz === null);
  want("at most INSIGHT_FINAL", out.candidates.length <= C.INSIGHT_FINAL);
  return fails;
}

function guardRules(C, value) {
  const fails = [];
  const want = (label, ok, d = "") => { if (!ok) fails.push(`${label}${d ? ` (${d})` : ""}`); };
  want("the real value is clean", C.insightKeyViolations(value).length === 0, C.insightKeyViolations(value)[0]);
  want("a number is flagged", C.insightKeyViolations({ ...value, ranked: [{ ...value.ranked[0], score: 3.2 }] }).length > 0);
  want("a dollar figure in words is flagged", C.insightKeyViolations({ ...value, ranked: [{ ...value.ranked[0], reason: "Closed at $101.50" }] }).length > 0);
  want("a price-shaped field is flagged even as text", C.insightKeyViolations({ ...value, ranked: [{ ...value.ranked[0], close: "high" }] }).length > 0);
  want("every event's words are clean", Object.values(C.INSIGHT_EVENTS).every((e) => C.insightKeyViolations({ reason: e.words }).length === 0));
  return fails;
}

async function writeRules(C) {
  const fails = [];
  const calls = [];
  const fake = { set: async (k, v) => { calls.push([k, v]); } };
  const r = await C.writeInsightCandidates(fake, new Map([["AAA", quiet()]]), ASOF, 0);
  if (!r.ok) fails.push(`the write runs on fixtures (${r.error})`);
  if (calls.length !== 1 || calls[0][0] !== C.INSIGHT_CANDIDATES_KEY) fails.push("one SET of the key");
  return fails;
}

function sourceRules(lib, jobs) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const l = stripComments(lib, { file: LIB });
  const j = stripComments(jobs, { file: JOBS });
  want("the write refuses a value its guard flags", /const bad = insightKeyViolations\(value\);\s*if \(bad\.length\) return \{ ok: false, error: `refused: \$\{bad\[0\]\}` \};\s*await r\.set\(INSIGHT_CANDIDATES_KEY/.test(l));
  want("tiingo-eod writes it on a complete night only", /const insightCandidates = complete \? await writeInsightCandidates\(r, bars, expected, nowMs\) : null;/.test(j));
  want("the write never throws (a failure is a result, not a failed night)", /\} catch \(err\) \{\s*return \{ ok: false, error:/.test(l));
  return fails;
}

try {
  const libSrc = read(LIB), jobsSrc = read(JOBS);
  const C = await load(libSrc);
  console.log("\n1. Events");
  const e = eventRules(C);
  check("gap, 52-week high, 200-day test, volume, results; none on a quiet day", e.length === 0, e.join("; "));
  console.log("\n2-3, 5. Ranking, #188, buzz");
  const s = selectRules(C);
  check("size x strength, top-cap only, filed period required, buzz", s.fails.length === 0, s.fails.join("; "));
  console.log("\n4. The read path's 30-day repeat rule");
  const rr = readRules(C, s.value);
  check("29 days out, 30 back in, spelling-proof, buzz too", rr.length === 0, rr.join("; "));
  console.log("\n6. The guard");
  const g = guardRules(C, s.value);
  check("no number, no figure, no price-shaped field", g.length === 0, g.join("; "));
  const w = await writeRules(C);
  check("the write: one SET, on fixtures", w.length === 0, w.join("; "));
  console.log("\n7. Source");
  const src = sourceRules(libSrc, jobsSrc);
  check("guarded write, complete night only, never throws", src.length === 0, src.join("; "));

  console.log("\n8. Planted mutants");
  const LM = [
    ["gap threshold at 4%", "if (gap >= 0.05) out.push(\"gap-up\");", "if (gap >= 0.04) out.push(\"gap-up\");", eventRules],
    ["52-week high on the high, not the close", "if (c > Math.max(...prior)) out.push(\"high-52w\");", "if (c > 1e9) out.push(\"high-52w\");", eventRules],
    ["results from a fortnight ago", "daysBetween(latest.announcedOn, asOf) <= 3", "daysBetween(latest.announcedOn, asOf) <= 14", eventRules],
    ["ranked by size alone", "return size * (top + 0.25 * rest.reduce((a, b) => a + b, 0));", "return size;", (C) => selectRules(C).fails],
    ["#188 dropped", "    if (why) { excluded.push({ symbol, why }); continue; }\n", "", (C) => selectRules(C).fails],
    ["the whole universe, not the top by cap", "const top = all.slice(0, INSIGHT_UNIVERSE);", "const top = all;", (C) => selectRules(C).fails],
    ["buzz under $10bn", "if (!hit || hit.cap < BUZZ_MIN_CAP || filedOk(hit.row)) continue;", "if (!hit || filedOk(hit.row)) continue;", (C) => selectRules(C).fails],
    ["repeats within 60 days", "return d !== undefined && daysBetween(d, value.asOf) < INSIGHT_REPEAT_DAYS;", "return d !== undefined && daysBetween(d, value.asOf) < 60;", (C) => readRules(C, selectRules(C).value)],
    ["the buzz pick repeats", "buzz: value.buzz && !recent(value.buzz.symbol) ? value.buzz : null,", "buzz: value.buzz,", (C) => readRules(C, selectRules(C).value)],
    ["the guard lets numbers through", "if (path !== \"$.v\") out.push(`${path} is a number`);", "void path;", (C) => guardRules(C, { ...selectRules(C).value })],
    ["the guard lets dollar figures through", "if (/\\$/.test(value) || /\\d+\\.\\d+/.test(value)) out.push(`${path} carries a figure`);", "void value;", (C) => guardRules(C, { ...selectRules(C).value })],
  ];
  for (const [label, from, to, rules] of LM) {
    if (!libSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = await rules(await load(libSrc.replace(from, to))); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const SM = [
    ["the write skips its guard", "lib", "    if (bad.length) return { ok: false, error: `refused: ${bad[0]}` };\n", ""],
    ["written on a partial night", "jobs", "const insightCandidates = complete ? await writeInsightCandidates(r, bars, expected, nowMs) : null;", "const insightCandidates = await writeInsightCandidates(r, bars, expected, nowMs);"],
  ];
  for (const [label, which, from, to] of SM) {
    const srcs = { lib: libSrc, jobs: jobsSrc };
    if (!srcs[which].includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const m = { ...srcs, [which]: srcs[which].replace(from, to) };
    const f = sourceRules(m.lib, m.jobs);
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}
console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
