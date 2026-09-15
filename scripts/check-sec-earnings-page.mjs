// The earnings page is on SEC data — the properties that must stay true.
//
// WHAT THIS CHECKS AND WHY IT IS SOURCE-LEVEL. The page renders from Redis and
// Redis is not reachable from a check, so there is no way to assert a rendered
// number here. What CAN be asserted is everything the owner's rules are actually
// about: that a card with no source is hidden rather than removed, that its
// reason is registered with what went away and when, that no retired FMP
// endpoint is still being called, and that nothing on the page claims a source
// it no longer has. Those are properties of the source, and the source is where
// a future deploy would break them.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const PAGE = "app/stock/[symbol]/earnings/page.tsx";
const CARDS = "app/stock/[symbol]/earnings/SecEarningsCards.tsx";
const VIEW = "lib/server/secEarningsView.ts";

const pageRaw = fs.readFileSync(PAGE, "utf8");
// readCodeOnly strips /* */ and // — it does NOT strip {/* ... */}, which is a
// JSX EXPRESSION containing a comment, and the page is full of them recording
// what moved off FMP. Scanning for user-visible text has to drop those too, or
// the record of the migration reads as a promise the page is still making.
const stripJsxComments = (src) => src.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
const pageCode = stripJsxComments(readCodeOnly(PAGE));
const cardsRaw = fs.readFileSync(CARDS, "utf8");
const cardsCode = stripJsxComments(readCodeOnly(CARDS));

// secEarningsView imports only from secFactStore, which imports Redis — so the
// registry is read as source rather than lifted. It is a literal array, and the
// assertions below are about its CONTENT, not its behaviour.
const viewRaw = fs.readFileSync(VIEW, "utf8");
const registryIds = [...viewRaw.matchAll(/^\s{4}id: "([a-z0-9-]+)",$/gm)].map((m) => m[1]);

console.log("\n1. the hide registry");

check("RETIRED_SOURCES has entries", registryIds.length > 0, registryIds.join(", "));
check("ids are unique", new Set(registryIds).size === registryIds.length);

// EVERY ENTRY CARRIES ALL FOUR FIELDS. A missing `retiredOn` is the difference
// between a record and a note.
const entries = [...viewRaw.matchAll(/\{\s*id: "([a-z0-9-]+)",([\s\S]*?)\n  \},/g)];
check("every entry names a label, a source and a date",
  entries.length === registryIds.length &&
    entries.every(([, , body]) => /label:/.test(body) && /source:/.test(body) && /retiredOn: "\d{4}-\d{2}-\d{2}"/.test(body) && /reason:/.test(body)),
  `${entries.length} complete of ${registryIds.length}`);

// THE TWO DIRECTIONS, AND BOTH MATTER. An id used with no entry throws at render
// (retiredSource does not fall back); an entry with no user is a card someone
// deleted instead of hiding, which loses the record the registry exists to keep.
const used = [...pageCode.matchAll(/<HiddenCard\s+id="([a-z0-9-]+)"/g)].map((m) => m[1]);
check("every HiddenCard id has a registry entry",
  used.every((id) => registryIds.includes(id)),
  used.filter((id) => !registryIds.includes(id)).join(", ") || `${used.length} used`);
check("every registry entry is used somewhere on the page",
  registryIds.every((id) => used.includes(id) || pageCode.includes(`"${id}"`) || cardsCode.includes(`"${id}"`)),
  registryIds.filter((id) => !used.includes(id) && !pageCode.includes(`"${id}"`) && !cardsCode.includes(`"${id}"`)).join(", ") || "all used");

// retiredSource must THROW on an unknown id rather than returning a placeholder.
// A soft fallback lets a card ship with an invented reason, which is the exact
// "switched back on with nothing behind it" case the registry exists to stop.
check("retiredSource throws on an unknown id rather than falling back",
  /throw new Error\(`no retired-source entry/.test(viewRaw));

console.log("\n2. hidden, not removed — the comment at the point of hiding");

// THE OWNER'S RULE IS THE COMMENT, NOT JUST THE COMPONENT. Read from the RAW
// source: readCodeOnly strips comments, so asserting on the stripped text would
// pass whatever was written.
for (const id of registryIds) {
  const at = pageRaw.indexOf(`<HiddenCard id="${id}"`);
  if (at === -1) continue;
  // The comment block immediately preceding this card, within ~1400 chars.
  const before = pageRaw.slice(Math.max(0, at - 1400), at);
  const comment = before.lastIndexOf("{/*");
  const body = comment === -1 ? "" : before.slice(comment);
  check(`${id}: the hiding is commented with what went away and when`,
    /2026-\d{2}-\d{2}/.test(body) && /FMP|companyfacts|segment axis/.test(body),
    comment === -1 ? "no comment before the card" : "");
}

console.log("\n3. nothing claims a source it no longer has");

// USER-VISIBLE TEXT ONLY. The file is full of the word FMP in comments, which is
// the record of what moved and must stay; what must not survive is a string the
// reader sees. Checked against the comment-stripped source for that reason.
const visibleFmp = [...pageCode.matchAll(/["'>][^"'<>]*\bFMP\b[^"'<>]*["'<]/g)].map((m) => m[0]);
check("no user-visible string on the page says FMP", visibleFmp.length === 0,
  visibleFmp.slice(0, 3).join(" | "));
check("...nor on the cards", !/\bFMP\b/.test(cardsCode),
  (cardsCode.match(/.{0,60}\bFMP\b.{0,60}/) ?? [""])[0]);

check("the attribution constant names SEC EDGAR",
  /SEC_ATTRIBUTION = "SEC EDGAR filings"/.test(viewRaw));
check("every card that states a source uses the constant, not a literal",
  !/Source: (?!\{SEC_ATTRIBUTION\})/.test(cardsRaw),
  "a second spelling of the source is a second thing to forget to update");

console.log("\n4. the retired endpoints are not still being called");

// The point is cost as well as correctness: a call whose result nothing renders
// is a paid request for nothing, and it is the state the page would be left in
// by deleting only the JSX.
const DEAD_ENDPOINTS = [
  "/analyst-estimates", "/income-statement", "/cash-flow-statement",
  "/balance-sheet-statement", "/revenue-product-segmentation",
  "/revenue-geographic-segmentation", "historical/earning_calendar",
];
for (const ep of DEAD_ENDPOINTS) {
  check(`no call to ${ep}`, !pageCode.includes(ep));
}
// /earnings STAYS, and on purpose: the announcement date and its bmo/amc timing
// are not in SEC filings, and the price-reaction card needs the session the
// market reacted in. Asserted so a later tidy-up does not remove it silently.
check("/earnings IS still called — the announcement date is not in SEC filings",
  pageCode.includes("`/earnings?symbol="),
  "price-derived, and this pass does not touch price-derived data");

console.log("\n5. labels");

check("EPS is labelled GAAP wherever it is named",
  (cardsRaw.match(/EPS \(GAAP\)/g) ?? []).length >= 3,
  `${(cardsRaw.match(/EPS \(GAAP\)/g) ?? []).length} occurrences`);
// The constant is a concatenation, so the sentence spans a `" +` — matched on
// the two halves rather than on a phrase that only exists once rendered.
check("the GAAP note explains that adjusted figures differ",
  /Companies often headline an adjusted/.test(viewRaw) &&
    /excludes one-off charges/.test(viewRaw));

// A DERIVED FIGURE IS LABELLED. Q4 and every cash-flow quarter but Q1 are
// arithmetic on filed numbers rather than filed numbers, and saying which is
// which is the difference between a figure a reader can check against the 10-Q
// and one they cannot.
check("derivationNote covers all three non-as-filed derivations",
  ["differenced", "computed", "ambiguous"].every((d) => new RegExp(`case "${d}":`).test(viewRaw)));
check("the cards render a derived mark from it",
  /derivedNote/.test(cardsCode) && /DerivedMark/.test(cardsCode));

// FISCAL, NOT CALENDAR. Two companies' "2026" can be nine months apart -- the
// probe set's year-ends are 31 Mar, 26 Sep, 3 Sep, 31 Oct, 31 Dec.
const codecEarly = fs.readFileSync("lib/server/secFactCodec.ts", "utf8");
check("period labels come from periodLabel, which is fiscal",
  /periodLabel/.test(readCodeOnly(VIEW)) && /FY\$\{p\.fy\}/.test(codecEarly));
check("and the page says the labels are the company's own fiscal calendar",
  /own fiscal calendar/.test(cardsRaw));

console.log("\n6. no zeros standing in for missing data");

// "EPS surprise: 0.00" reads as "came in exactly in line", which is a claim, and
// a false one. Nothing that renders a stored value may coalesce null to 0.
const coalesced = [...cardsCode.matchAll(/(?:cell|val|value)\w*\s*\?\?\s*0\b/g)].map((m) => m[0]);
check("no ?? 0 on a rendered value", coalesced.length === 0, coalesced.join(", "));
check("a null value renders an em dash",
  /return "—"/.test(cardsCode) && /\?\s*"—"/.test(cardsCode));

console.log("\n7. the store's gate");

const storeRaw = fs.readFileSync("lib/server/secFactStore.ts", "utf8");
// The positional codec lives in its own file, with no Redis import, so a relay
// probe can run the whole render path against real filings. The store is the
// I/O half; the assertions below split accordingly.
const codecRaw = fs.readFileSync("lib/server/secFactCodec.ts", "utf8");
check("readFactSet refuses a set whose fieldsHash differs",
  /raw\.h !== secFieldsHash\(\)/.test(storeRaw) && /return null;/.test(storeRaw));
// STRIPPED, NOT RAW. The first version of this matched the store's own comment
// -- "reading them anyway is the silent-wrong-number failure" -- and reported a
// failure for explaining the rule it was checking.
check("...and the mismatch branch returns null with no fallback decode",
  (() => {
    const src = readCodeOnly("lib/server/secFactStore.ts");
    const at = src.indexOf("raw.h !== secFieldsHash()");
    // The next statement after the warn must be the return. A `[^}]*` window
    // cannot be used: the warn's template literal contains a `}` of its own.
    // Exactly this branch: from the condition to the `}` that closes it. A
    // fixed window ran past it into the next guard and read that as a decode.
    const branch = src.slice(at, at + src.slice(at).indexOf("\n    }"));
    return at !== -1 && /return null;/.test(branch) &&
      !/raw\.(?:quarters|years|instants)/.test(branch);
  })(),
  "a positional array read against the wrong field order is 46 wrong numbers");
check("ttm() refuses a partial year",
  /if \(four\.length < 4\) return null;/.test(codecRaw) &&
    /if \(vals\.some\(\(v\) => v === null\)\) return null;/.test(codecRaw),
  "after D1b, Q4 EPS is legitimately null, so the three-quarter case is common");

console.log("\n8. the population path");

const jobRaw = fs.readFileSync("app/api/jobs/sec-facts/route.ts", "utf8");
check("the job is keyed on contentHash === null, not on a one-off list",
  /e\.contentHash === null/.test(jobRaw));
check("reverify and populate have SEPARATE allowances",
  /SEC_REVERIFY_PER_RUN/.test(jobRaw) && /SEC_POPULATE_PER_RUN/.test(jobRaw) &&
    !/SHARED_PER_RUN/.test(jobRaw));
check("a failed fetch does NOT clear needsReverify",
  /NOT CLEARED ON FAILURE/.test(jobRaw));
check("the run logs one line whatever happens",
  /console\.log\("\[sec-facts\]"/.test(jobRaw));
check("a content-hash move with no filing event is logged as a silent restatement",
  /SILENT RESTATEMENT/.test(jobRaw));
check("it is registered as a cron",
  JSON.parse(fs.readFileSync("vercel.json", "utf8")).crons.some((c) => c.path === "/api/jobs/sec-facts"));

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nThe earnings page's source properties hold.\n");
process.exit(failures ? 1 : 0);
