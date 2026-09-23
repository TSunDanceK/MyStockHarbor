// THE PER-RUN FX SERIES CACHE SERVES ONLY SPANS ITS FETCH WINDOW COVERS.
//
// #535 COWORK #8 / CODE #12. sec-facts shares one Map<currency, series> across
// a run. It used to be reused for every later filer in the currency whatever
// its span, so ENB's two newest quarters were refused behind BMO's series
// (fetched to 31 Jan 2026) and VOD lost its 2022 periods behind MICC's —
// replayed on live data, relay 35865921726. Pinned offline with a stub source
// that serves exactly the window it is asked for:
//   1. a later filer whose span runs past the cached window gets its newest
//      periods converted (not refused), via ONE refetch of the union window;
//   2. an earlier-starting span likewise;
//   3. a span inside the window reuses the cache (no fetch);
//   4. a remembered failure (null) is not retried within the run.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const strip = (f) => fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const load = (mutate = (s) => s) => lift(mutate([fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/secExtract.ts"), strip("lib/server/fxRates.ts"), strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"), strip("lib/server/secFactBuild.ts")].join("\n")));

const day = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
let calls = [];
const stub = (fail = false) => ({
  id: "stub", supports: (c) => c === "CAD",
  async fetchSeries(c, from, to) {
    calls.push(`${from}..${to}`);
    if (fail) throw new Error("down");
    const out = [];
    for (let d = from; d <= to; d = day(d, 1)) out.push({ date: d, usdPerUnit: 0.73 });
    return out;
  },
});
// A CAD filer with quarterly revenue up to `last`, starting at `first`.
const filer = (sym, first, last) => {
  const rows = [];
  for (let e = first; e <= last; e = day(e, 91)) rows.push({ start: day(e, -90), end: e, val: 1e9, accn: `a-${e}`, fy: 2025, fp: "Q1", form: "10-Q", filed: day(e, 30) });
  return { cik: 1, entityName: sym, facts: { "us-gaap": { Revenues: { units: { CAD: rows } }, NetIncomeLoss: { units: { CAD: rows.map((r) => ({ ...r, val: 1e8 })) } } } } };
};
const newestStored = (set) => [...set.quarters, ...set.years].map((p) => p.e).sort().at(-1);

const run = async (M) => {
  calls = [];
  const cache = new Map();
  const src = [stub()];
  const bmo = await M.toStoredSet(M.extractCompanyFacts("BMO", filer("BMO", "2024-01-31", "2026-01-31")), src, cache);
  const enb = await M.toStoredSet(M.extractCompanyFacts("ENB", filer("ENB", "2024-03-31", "2026-06-30")), src, cache);
  const afterEnb = calls.length;
  const old = await M.toStoredSet(M.extractCompanyFacts("OLD", filer("OLD", "2022-03-31", "2023-03-31")), src, cache);
  const afterOld = calls.length;
  const inside = await M.toStoredSet(M.extractCompanyFacts("IN", filer("IN", "2024-06-30", "2025-06-30")), src, cache);
  return { bmo, enb, old, inside, afterEnb, afterOld, afterInside: calls.length };
};

const M = await load();
const R = await run(M);
check("BMO converts to its own newest quarter", newestStored(R.bmo) === R.bmo.quarters[0].e && !(R.bmo.fx?.refused ?? []).length);
check("ENB, after BMO primed the cache, keeps its newest periods (no refusals)",
  !(R.enb.fx?.refused ?? []).length && newestStored(R.enb) >= "2026-06-01", `refused ${JSON.stringify(R.enb.fx?.refused)} newest ${newestStored(R.enb)}`);
check("…with exactly one refetch of the widened window", R.afterEnb === 2, calls.join(" | "));
check("an earlier-starting span is covered too (one more refetch)", !(R.old.fx?.refused ?? []).length && R.afterOld === 3, calls.join(" | "));
check("a span inside the window reuses the cache (no fetch)", R.afterInside === 3 && !(R.inside.fx?.refused ?? []).length);
{
  calls = [];
  const cache = new Map();
  await M.toStoredSet(M.extractCompanyFacts("A", filer("A", "2024-01-31", "2025-01-31")), [stub(true)], cache);
  await M.toStoredSet(M.extractCompanyFacts("B", filer("B", "2024-01-31", "2026-01-31")), [stub(true)], cache);
  check("a remembered failure is not retried within the run", calls.length === 1, calls.join(" | "));
}
const OLD_RULE = "if (series && !(series.window && series.window.from <= want.from && series.window.to >= want.to)) {";
const src = fs.readFileSync("lib/server/secFactBuild.ts", "utf8");
check("the coverage rule is present", src.includes(OLD_RULE));
const mut = await load((s) => s.replace(OLD_RULE, "if (false) {"));
const Rm = await run(mut);
check("MUTATION \"reuse whatever is cached\" reproduces ENB's refused quarters", (Rm.enb.fx?.refused ?? []).length > 0, JSON.stringify(Rm.enb.fx?.refused));

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nThe FX series cache serves only what it covers.\n");
process.exit(failures ? 1 : 0);
