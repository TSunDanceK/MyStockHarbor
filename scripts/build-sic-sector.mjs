// SIC CODE → SECTOR, MEASURED, NOT WRITTEN → data/sec/sic-sector.json
//
// Brief 2026-09-22 §2.4 item 3: the leg after the static snapshot, so a symbol
// that enters the universe after the snapshot was taken (an IPO, universe
// growth) still lands on a sector page. The target is the 11 sector slugs in
// lib/sectors.ts, whose labels are FMP's.
//
// ── WHY IT IS DERIVED FROM DATA ──────────────────────────────────────────
// A hand-written SIC→sector table is ~400 judgement calls, each a plausible
// wrong sector on every page it touches. But 2,619 symbols already carry BOTH
// an FMP sector (data/static-profile.json) and, from the sec-registrants run,
// the SIC code SEC files them under. So each code's sector is whatever its
// known members are, by majority, with the agreement rate recorded beside it.
//
// ── A CODE IS MAPPED ONLY WHEN THE EVIDENCE SUPPORTS IT ──────────────────
//   code: n >= MIN_MEMBERS and share >= MIN_SHARE  → majority sector ("code")
//   else its 2-digit major group, n >= 5, same share → majority ("major-group")
//   otherwise                                       → "unclassified", REPORTED
// Nothing is dropped silently: an unclassified code is listed with its
// members and its split, for the owner to decide.
//
//   node scripts/build-sic-sector.mjs          (writes the file)
//   node scripts/build-sic-sector.mjs --check  (exits 1 if the file is stale)
import fs from "node:fs";

const MIN_MEMBERS = 3;
const MIN_SHARE = 0.7;

const registrants = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8"));
const snapshot = JSON.parse(fs.readFileSync("data/static-profile.json", "utf8"));
const SECTORS = [...fs.readFileSync("lib/sectors.ts", "utf8").matchAll(/fmpLabel: "([^"]+)"/g)].map((m) => m[1]);
if (SECTORS.length !== 11) { console.error(`FATAL: expected 11 sectors in lib/sectors.ts, read ${SECTORS.length}`); process.exit(2); }

const bySic = new Map();
for (const [symbol, reg] of Object.entries(registrants.rows)) {
  if (!reg.sic) continue;
  const e = bySic.get(reg.sic) ?? { description: reg.sicDescription, votes: new Map(), members: 0 };
  e.members++;
  const sector = snapshot.rows[symbol]?.sector ?? null;
  if (sector) e.votes.set(sector, (e.votes.get(sector) ?? 0) + 1);
  bySic.set(reg.sic, e);
}

// ── SECOND TIER: THE 2-DIGIT MAJOR GROUP ────────────────────────────────
// Most codes that fail do so on MEMBERSHIP, not agreement — one or two known
// symbols (Tobacco Products: 2 of 2 Consumer Defensive). SIC is hierarchical,
// so such a code falls back to its major group (21xx), measured the same way
// with a higher floor. Recorded as basis "major-group" so it is never mistaken
// for a code-level reading.
const MIN_GROUP_MEMBERS = 5;
const group = new Map();
for (const [sic, e] of bySic) {
  const g = group.get(sic.slice(0, 2)) ?? new Map();
  for (const [sector, c] of e.votes) g.set(sector, (g.get(sector) ?? 0) + c);
  group.set(sic.slice(0, 2), g);
}
const verdict = (votes, minMembers) => {
  const n = [...votes.values()].reduce((a, b) => a + b, 0);
  const [top, topN] = [...votes].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const share = n ? topN / n : 0;
  return { n, top, share, ok: n >= minMembers && share >= MIN_SHARE && SECTORS.includes(top) };
};

const codes = {};
const unclassified = [];
let mappedSymbols = 0, votingSymbols = 0, byGroup = 0;
for (const [sic, e] of [...bySic].sort((a, b) => a[0].localeCompare(b[0]))) {
  const own = verdict(e.votes, MIN_MEMBERS);
  const grp = own.ok ? null : verdict(group.get(sic.slice(0, 2)), MIN_GROUP_MEMBERS);
  const chosen = own.ok ? own : grp?.ok ? grp : null;
  votingSymbols += own.n;
  if (chosen) mappedSymbols += e.votes.get(chosen.top) ?? 0;
  if (!own.ok && grp?.ok) byGroup++;
  codes[sic] = {
    description: e.description,
    sector: chosen ? chosen.top : null,
    basis: own.ok ? "code" : grp?.ok ? "major-group" : null,
    members: own.n,
    agreement: Number((chosen ?? own).share.toFixed(3)),
    split: Object.fromEntries([...e.votes].sort((a, b) => b[1] - a[1])),
  };
  if (!chosen) unclassified.push(sic);
}

const file = {
  _comment:
    "SIC code -> FMP sector label, derived from the symbols carrying both (data/sec/registrants.json x " +
    "data/static-profile.json). A code maps only with >= " + MIN_MEMBERS + " known members and >= " +
    Math.round(MIN_SHARE * 100) + "% agreement (basis code), else its 2-digit major group under the same share " +
    "with >= 5 members (basis major-group); otherwise sector is null (unclassified, reported). " +
    "Regenerate with node scripts/build-sic-sector.mjs.",
  registrantsAsOf: registrants.asOf,
  snapshotAsOf: snapshot.asOf,
  rule: { minMembers: MIN_MEMBERS, minShare: MIN_SHARE, majorGroupMinMembers: MIN_GROUP_MEMBERS },
  codes,
};
const json = JSON.stringify(file, null, 1) + "\n";

if (process.argv.includes("--check")) {
  const committed = fs.existsSync("data/sec/sic-sector.json") ? fs.readFileSync("data/sec/sic-sector.json", "utf8") : "";
  if (committed !== json) { console.error("data/sec/sic-sector.json is stale — run node scripts/build-sic-sector.mjs"); process.exit(1); }
  console.log("data/sec/sic-sector.json is current");
  process.exit(0);
}
fs.writeFileSync("data/sec/sic-sector.json", json);

const mapped = Object.values(codes).filter((c) => c.sector).length;
console.log(`SIC codes found: ${bySic.size} · mapped: ${mapped} (${mapped - byGroup} by code, ${byGroup} by major group) · unclassified: ${unclassified.length}`);
console.log(`symbols with a snapshot sector and a SIC code: ${votingSymbols} · agreeing with their code's mapped sector: ${mappedSymbols} (${(100 * mappedSymbols / Math.max(votingSymbols, 1)).toFixed(1)}%)`);
console.log(`\nUNCLASSIFIED (sector null) — code, members, top share, split:`);
for (const sic of unclassified) {
  const c = codes[sic];
  console.log(`  ${sic.padEnd(5)} n=${String(c.members).padStart(3)} ${(100 * c.agreement).toFixed(0).padStart(3)}%  ${c.description ?? ""} — ${JSON.stringify(c.split)}`);
}
