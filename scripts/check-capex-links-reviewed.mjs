// Capex named links, plan (c): the reviewed-links data file (Relay C, #563
// COWORK #19). Every link on the page is one a reviewer read in the filer's own
// annual report; this check guards the file those links live in.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. AN UNREVIEWED OR REJECTED LINK SHOWN. Only verdict "correct" may sit in
//      `links`; everything else lives in `rejected`, which the page never reads.
//   2. A LINK WITHOUT ITS EVIDENCE: no quote, a quote that does not name the
//      party, or no accession / filing date to trace it back.
//   3. A DOLLAR FLOW. The ruling is "no estimated company-to-company flows":
//      no numeric fields at all, and a filed percentage only inside the quote.
//   4. DISHONEST PROVENANCE. The review is a CODE-C session's, audited by
//      Cowork; the file must not claim hand or human review.
//   5. AN AUDIT SAMPLE NOBODY CAN REPRODUCE. The draw is Python's
//      random.Random(seed).sample(population, 20); scripts/lib/py-random.mjs
//      reproduces it bit for bit, and this check re-runs it against the stored
//      population and fails unless it yields the stored sample (#563 COWORK #20).
//   6. SCOPE DRIFT: parties outside the batch's receivers, untracked tickers,
//      a filer linked to itself, or the same link twice.
//
//   node scripts/check-capex-links-reviewed.mjs
import fs from "node:fs";
import { pyRandom } from "./lib/py-random.mjs";

const FILE = "data/capex/links-reviewed.json";
const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
const registrants = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const receivers = JSON.parse(fs.readFileSync("data/capex/receivers.json", "utf8")).rows;

const ROLES = new Set(["supplier", "customer"]);
const REJECT_VERDICTS = new Set(["not-established", "wrong-entity"]);
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FORMS = new Set(["10-K", "10-KT", "20-F"]);
const HAND_CLAIM = /\bby hand\b|\bhand[- ](?:checked|reviewed|picked)\b|\bhuman (?:review|analyst)/i;
const MAX_QUOTE = 700;

function validate(d) {
  const fails = [];
  const ok = (label, cond) => { if (!cond) fails.push(label); };
  ok("top-level shape", d && typeof d === "object" && Array.isArray(d.links) && Array.isArray(d.rejected));
  if (!Array.isArray(d?.links) || !Array.isArray(d?.rejected)) return fails;
  ok("reviewer names the real reviewer", typeof d.reviewer === "string" && /CODE-C/.test(d.reviewer));
  // ONE PINNED AUDIT PER BATCH (#563 COWORK #20/#23). Each batch's population is
  // exactly that batch's published links (less any added after its draw); the
  // draw is random.Random(seed).sample(population, min(20, n)), re-run here.
  const audits = Array.isArray(d.audits) ? d.audits : [];
  const batches = [...new Set(d.links.map((l) => l.batch))].sort();
  ok("every link carries a batch tag", d.links.every((l) => typeof l.batch === "string" && l.batch.length > 0));
  ok("one audit per batch", audits.length === batches.length && batches.every((b) => audits.some((a) => String(a.batch) === b)));
  ok("audit seeds are distinct", new Set(audits.map((a) => a.seed)).size === audits.length);
  for (const a of audits) {
    const tag = `audit (batch ${a.batch})`;
    ok(`${tag}: a seed and status`, Number.isInteger(a.seed) && typeof a.status === "string");
    if (!(Array.isArray(a.population) && Array.isArray(a.drawOrder) && Array.isArray(a.sample))) {
      ok(`${tag}: stores population, drawOrder and sample`, false);
      continue;
    }
    const pop = a.population;
    ok(`${tag}: population sorted as stored (Python's sorted() on ASCII keys)`, pop.every((k, i) => i === 0 || pop[i - 1] < k));
    const n = Math.min(20, pop.length);
    ok(`${tag}: draws min(20, population)`, a.drawOrder.length === n);
    const redraw = pyRandom(a.seed).sample(pop, a.drawOrder.length);
    ok(`${tag}: random.Random(seed).sample(population, n) == drawOrder`, JSON.stringify(redraw) === JSON.stringify(a.drawOrder));
    ok(`${tag}: sample is the draw, sorted`, JSON.stringify([...a.drawOrder].sort()) === JSON.stringify(a.sample));
    ok(`${tag}: sample distinct`, new Set(a.sample).size === a.sample.length);
    const published = new Set(d.links.filter((l) => l.batch === String(a.batch)).map((l) => `${l.filer}|${l.party}|${l.role}`));
    ok(`${tag}: every audited link is still published in its batch`, a.sample.every((k) => published.has(k)));
    const after = new Set(a.addedAfterDraw ?? []);
    ok(`${tag}: population is exactly the batch's published links, less those added after the draw`,
      pop.length + after.size === published.size && pop.every((k) => published.has(k) && !after.has(k)) && [...after].every((k) => published.has(k)));
  }
  ok("no claim of hand or human review anywhere", !HAND_CLAIM.test(JSON.stringify(d)));
  const excluded = new Set(d.excludedReceivers ?? []);
  const scope = new Set(receivers.map((r) => r.ticker).filter((t) => !excluded.has(t)));
  const seen = new Set();
  const numericKeys = (o) => Object.entries(o).filter(([, v]) => typeof v === "number").map(([k]) => k);
  for (const [i, l] of d.links.entries()) {
    const at = `links[${i}] ${l.filer}→${l.party}`;
    ok(`${at}: verdict is "correct"`, l.verdict === "correct");
    ok(`${at}: role`, ROLES.has(l.role));
    ok(`${at}: filer is tracked`, Boolean(registrants[l.filer]));
    ok(`${at}: party is tracked`, Boolean(registrants[l.party]));
    // in scope (COWORK #20 F1): a receiver as supplier or customer of any filer,
    // or a receiver's own named customer or supplier -- one side is a receiver
    ok(`${at}: in the batch's scope`, scope.has(l.party) || scope.has(l.filer));
    ok(`${at}: not linked to itself`, l.filer !== l.party);
    ok(`${at}: accession`, ACCESSION.test(l.accession ?? ""));
    ok(`${at}: form`, FORMS.has(l.form));
    ok(`${at}: filing date`, ISO_DATE.test(l.filingDate ?? ""));
    ok(`${at}: review date`, ISO_DATE.test(l.reviewedAt ?? ""));
    ok(`${at}: quote present and bounded`, typeof l.quote === "string" && l.quote.length >= 20 && l.quote.length <= MAX_QUOTE);
    ok(`${at}: quote names the party as filed`, typeof l.partyAsFiled === "string" && l.partyAsFiled.length > 1 && (l.quote ?? "").includes(l.partyAsFiled));
    ok(`${at}: no numeric fields (no dollar flows)`, numericKeys(l).length === 0);
    const key = `${l.filer}|${l.party}|${l.role}`;
    ok(`${at}: unique`, !seen.has(key));
    seen.add(key);
  }
  for (const [i, r] of d.rejected.entries()) {
    const at = `rejected[${i}] ${r.filer}→${r.party}`;
    ok(`${at}: a rejection verdict`, REJECT_VERDICTS.has(r.verdict));
    ok(`${at}: accession`, ACCESSION.test(r.accession ?? ""));
    ok(`${at}: note`, typeof r.note === "string" && r.note.length > 0);
    ok(`${at}: not also published`, !seen.has(`${r.filer}|${r.party}|supplier`) && !seen.has(`${r.filer}|${r.party}|customer`));
  }
  for (const [i, r] of (d.deferred ?? []).entries()) {
    ok(`deferred[${i}] ${r.filer}→${r.party}: has a reason`, typeof r.reason === "string" && r.reason.length > 0);
    ok(`deferred[${i}] ${r.filer}→${r.party}: not also published`, !seen.has(`${r.filer}|${r.party}|${r.role}`));
  }
  const c = d.counts ?? {};
  ok("counts match the lists", c.confirmed === d.links.length && c.reviewed === d.links.length + d.rejected.length &&
    c.notEstablished === d.rejected.filter((r) => r.verdict === "not-established").length &&
    c.wrongEntity === d.rejected.filter((r) => r.verdict === "wrong-entity").length);
  return fails;
}

const results = [];
const real = validate(data);
results.push([`${FILE} passes (${data.links.length} links, ${data.rejected.length} rejected)`, real.length === 0, real.slice(0, 5).join("; ")]);

// MUTANTS: each is one way the file could go wrong; each must be caught.
const clone = () => JSON.parse(JSON.stringify(data));
const first = (d) => d.links[0];
const MUTANTS = {
  "a rejected verdict in links": (d) => { first(d).verdict = "not-established"; },
  "a link with no quote": (d) => { first(d).quote = ""; },
  "a quote that does not name the party": (d) => { first(d).partyAsFiled = "Nonexistent Party Name Co"; },
  "a dollar figure on a link": (d) => { first(d).amount = 5e9; },
  "a bad accession": (d) => { first(d).accession = "123"; },
  "an untracked party": (d) => { first(d).party = "ZZZZNOTREAL"; },
  "a party outside the batch (hyperscaler excluded)": (d) => { const l = d.links.find((x) => x.role === "supplier" && x.filer === "FTNT"); l.party = "AMZN"; },
  "a link with no receiver on either side": (d) => { const l = d.links.find((x) => x.filer === "FTNT") ?? first(d); l.party = "HON"; },
  "a deferred link also published": (d) => { const l = { ...first(d) }; d.deferred = [{ ...l, reason: "held" }]; },
  "an audit sample that is not the seeded draw": (d) => { const a = d.audits[0]; a.drawOrder[0] = a.population.find((k) => !a.drawOrder.includes(k)); a.sample = [...a.drawOrder].sort(); },
  "an audit population missing a published link": (d) => { d.audits[0].population = d.audits[0].population.slice(1); },
  "a different audit seed": (d) => { d.audits[0].seed += 1; },
  "an audited link no longer published": (d) => { const k = d.audits[0].sample[0]; d.links = d.links.filter((l) => `${l.filer}|${l.party}|${l.role}` !== k); d.counts.confirmed--; d.counts.reviewed--; },
  "batch 2's draw tampered": (d) => { const a = d.audits[1]; a.drawOrder = [...a.drawOrder].reverse(); },
  "batch 2 without its audit": (d) => { d.audits = d.audits.slice(0, 1); },
  "a batch-2 link moved into batch 1's population": (d) => { const l = d.links.find((x) => x.batch === "2"); l.batch = "1"; },
  "two batches sharing one seed": (d) => { d.audits[1].seed = d.audits[0].seed; },
  "a filer linked to itself": (d) => { first(d).party = first(d).filer; },
  "the same link twice": (d) => { d.links.push({ ...first(d) }); d.counts.confirmed++; d.counts.reviewed++; },
  "a hand-review claim": (d) => { d.about = `${d.about} Checked by hand.`; },
  "reviewer not named": (d) => { d.reviewer = "analyst"; },
  "counts out of step": (d) => { d.counts.confirmed += 1; },
  "a rejection with no note": (d) => { if (d.rejected[0]) d.rejected[0].note = ""; else d.rejected.push({ verdict: "not-established", accession: "0000000000-00-000000", note: "" }); },
  "a role outside supplier/customer": (d) => { first(d).role = "partner"; },
};
for (const [name, mutate] of Object.entries(MUTANTS)) {
  const d = clone();
  mutate(d);
  results.push([`mutant caught: ${name}`, validate(d).length > 0, ""]);
}

let bad = 0;
for (const [label, pass, detail] of results) {
  if (!pass) bad++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
}
console.log(bad ? `\n${bad} FAILED` : `\nALL CHECKS PASSED (${Object.keys(MUTANTS).length} mutants)`);
process.exit(bad ? 1 : 0);
