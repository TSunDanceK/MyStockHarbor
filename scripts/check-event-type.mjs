// eventType derivation (§7) and the art selection it drives.
//
// WHAT IS AT RISK. eventType does not change a word of text — it changes the
// PICTURE. Every failure here is silent:
//
//   1. A WRONG TYPE ASSERTS SOMETHING. event-earnings art on a lawsuit story
//      claims the article is about earnings. A sector illustration claims
//      nothing. So null must be preferred over a guess, and null must fall
//      through to SECTOR and never to an event bucket.
//   2. THE BUCKET NAMES DO NOT MATCH THE TYPE NAMES. The union is singular
//      ("deal"), the library is plural ("event-deals"). `event-${eventType}`
//      resolves to nothing, renders nothing, and fails no build.
//   3. THE WEAK LEG CARRIES THE VOLUME. Title keywords are the least reliable
//      signal and Google News is the per-symbol primary, so most event art
//      will be chosen by the weakest evidence in the set. The distribution is
//      measured against a real poll rather than assumed.
//
// FIXTURES: eventtype-{gnews,wire,sec}.jsonl are digests of ONE REAL POLL
// (relay task eventtype-sample). They carry only the raw inputs the cascade
// reads, so the numbers below describe the shipped derivation running over real
// data, not a reimplementation of it.
//
//   node scripts/check-event-type.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const readIf = (p) => (fs.existsSync(path.join(ROOT, p)) ? read(p) : null);
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const loadTs = async (source, tag) => {
  const file = path.join(ROOT, `.check-${tag}.mjs`);
  fs.writeFileSync(file, ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
  try { return await import(`${pathToFileURL(file).href}?t=${Date.now()}`); }
  finally { fs.unlinkSync(file); }
};

// ───────────────────────────────────────────────────────────────── the cascade
let evSrc = read("lib/server/news/eventType.ts")
  .replace(/^import type \{ NewsItem \} from ".\/types";$/m, "")
  .replace(/^export type EventType = NonNullable<NewsItem\["eventType"\]>;$/m, "")
  .replace(/^export type EventTypeLeg = .*$/m, "")
  .replace(/^export type EventTypeInputs = \{[\s\S]*?^\};$/m, "")
  .replace(/const ITEM_EVENT_TYPES: Record<string, EventType>/, "const ITEM_EVENT_TYPES")
  .replace(/const (FORM|SUBJECT|TITLE)_EVENT_TYPES: Array<\[RegExp, EventType\]>/g, "const $1_EVENT_TYPES")
  .replace(/export function eventTypeFromForm\(form: string, items: string\): EventType/, "export function eventTypeFromForm(form, items)")
  .replace(/export function eventTypeFromSubjects\(subjects: string\[\]\): EventType \| null/, "export function eventTypeFromSubjects(subjects)")
  .replace(/export function eventTypeFromTitle\(title: string\): EventType \| null/, "export function eventTypeFromTitle(title)")
  .replace(/export function deriveEventType\(inputs: EventTypeInputs\): \{[\s\S]*?^\} \{/m, "export function deriveEventType(inputs) {");
if (/^import /m.test(evSrc)) {
  console.error("FAIL: an import survived inlining:\n" + evSrc.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
for (const [marker, why] of [
  ["export function deriveEventType(inputs) {", "the deriveEventType signature was not de-typed"],
  ["const TITLE_EVENT_TYPES = [", "the title table was not de-typed"],
]) {
  if (!evSrc.includes(marker)) { console.error(`FAIL: ${why} — a substitution stopped matching.`); process.exit(1); }
}
const ev = await loadTs(evSrc, "eventtype");

// ─────────────────────────────────────────────────────────────────── the art
// PARAMETERISED ON THE MANIFEST, because §6's degrade path can only be tested
// against a manifest that actually lacks the art — and patching the inlined
// manifest afterwards is how the first attempt at that silently swallowed the
// next declaration (the JSON ends with a newline, so the `;` lands on its own
// line and an `^};$` anchor runs straight past it).
const buildArtSrc = (manifestJson) => read("lib/server/news/art.ts")
  .replace(/^import manifest from "@\/public\/news-art\/manifest.json";$/m,
    () => `const manifest = ${manifestJson};`)
  .replace(/^import type \{ EventType \} from ".\/eventType";$/m, "")
  .replace("const BUCKET_COUNTS = manifest as Record<string, number>;", "const BUCKET_COUNTS = manifest;")
  .replace(/const EVENT_BUCKETS: Record<EventType, string>/, "const EVENT_BUCKETS")
  .replace(/const INDUSTRY_BUCKETS: Array<\[RegExp, string\]>/, "const INDUSTRY_BUCKETS")
  .replace(/const SECTOR_BUCKETS: Record<string, string>/, "const SECTOR_BUCKETS")
  .replace(/export function bucketForItem\(\n  eventType: EventType \| null \| undefined,\n  sectorBucket: string \| null\n\): string \| null \{/, "export function bucketForItem(eventType, sectorBucket) {")
  .replace(/export function bucketFor\(sector: string \| null, industry: string \| null\): string \| null/, "export function bucketFor(sector, industry)")
  .replace(/export function bucketCount\(bucket: string \| null\): number/, "export function bucketCount(bucket)")
  .replace(/export function hashKey\(key: string\): number/, "export function hashKey(key)")
  .replace(/export type NewsArt = \{[\s\S]*?^\};$/m, "")
  .replace(/const pad = \(n: number\)/, "const pad = (n)")
  .replace(/function artAt\(bucket: string, index: number\): NewsArt \{/, "function artAt(bucket, index) {")
  .replace(/export function pickArt\(bucket: string \| null, key: string, taken\?: Set<number>\): NewsArt \| null \{/, "export function pickArt(bucket, key, taken) {");

const artSrc = buildArtSrc(read("public/news-art/manifest.json"));
if (/^import /m.test(artSrc)) {
  console.error("FAIL: an import survived inlining art.ts:\n" + artSrc.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
if (!artSrc.includes("export function bucketForItem(eventType, sectorBucket) {")) {
  console.error("FAIL: bucketForItem was not de-typed — a substitution stopped matching."); process.exit(1);
}
const art = await loadTs(artSrc, "art");

const ALL_TYPES = ["earnings", "filing", "analyst", "deal", "macro"];

console.log("\n=== 1. Leg 1, SEC form type: the strongest signal, and it never guesses ===\n");
check(
  "an 8-K's item code outranks its form",
  ev.eventTypeFromForm("8-K", "2.02,9.01") === "earnings",
  "every 8-K is 'a current report', which says nothing; Item 2.02 says it is the quarterly numbers"
);
check(
  "the periodic reports ARE the earnings disclosure",
  ev.eventTypeFromForm("10-Q", "") === "earnings" && ev.eventTypeFromForm("10-K", "") === "earnings"
);
check(
  "ownership and merger forms are deals",
  ev.eventTypeFromForm("SC 13D", "") === "deal" &&
    ev.eventTypeFromForm("SC 13G", "") === "deal" &&
    ev.eventTypeFromForm("DEFM14A", "") === "deal"
);
check(
  'EDGAR\'s OWN SPELLING "SCHEDULE 13G" is a deal, not a filing',
  ev.eventTypeFromForm("SCHEDULE 13G", "") === "deal" &&
    ev.eventTypeFromForm("SCHEDULE 13G/A", "") === "deal" &&
    ev.eventTypeFromForm("SCHEDULE 13D", "") === "deal",
  "the real bug this measurement found: the pattern was written /^SC 13[DG]/ from the documentation, and the submissions API writes SCHEDULE — 19 filings across 8 of 16 sampled symbols fell silently through to 'filing'"
);
check(
  "an amendment counts as its base form",
  ev.eventTypeFromForm("10-K/A", "") === "earnings" && ev.eventTypeFromForm("8-K/A", "2.02") === "earnings"
);
check(
  "item codes are trimmed before lookup",
  ev.eventTypeFromForm("8-K", " 2.02 , 9.01 ") === "earnings",
  "one padded feed should not make Item 2.02 unrecognisable"
);
check(
  "a material-agreement 8-K is a deal",
  ev.eventTypeFromForm("8-K", "1.01") === "deal" && ev.eventTypeFromForm("8-K", "2.01,9.01") === "deal"
);
check(
  "this leg NEVER returns null — 'filing' is a truthful floor for anything filed",
  ALL_TYPES.length > 0 &&
    ["4", "144", "3", "8-K", "S-1", "N-CSRS", "", "SOMETHING-NEW"].every((f) => ev.eventTypeFromForm(f, "") !== null),
  "the one leg that cannot be wrong: a filing is a filing regardless of what the form says"
);
check(
  "a bare 8-K stays 'filing' rather than guessing at its contents",
  ev.eventTypeFromForm("8-K", "") === "filing",
  "8-K means 'something happened'; without an item code nothing more is known"
);
check(
  "an unknown item code falls back to the form, not to nothing",
  ev.eventTypeFromForm("10-Q", "9.99") === "earnings"
);
check(
  "DEF 14A (annual proxy) is NOT treated as a deal",
  ev.eventTypeFromForm("DEF 14A", "") === "filing",
  "only DEFM14A, the merger proxy, is — the two differ by one letter and by their entire meaning"
);

console.log("\n=== 2. Leg 2, wire subjects ===\n");
check("an earnings subject maps", ev.eventTypeFromSubjects(["Earnings"]) === "earnings");
check("a joint venture is a deal", ev.eventTypeFromSubjects(["Joint Ventures"]) === "deal");
check(
  "an unmapped subject yields null rather than a guess",
  ev.eventTypeFromSubjects(["Broadcast Feed Annoucement"]) === null,
  "the real PR Newswire item that motivated this — it is not an event type"
);
check("no subjects at all is null", ev.eventTypeFromSubjects([]) === null);

console.log("\n=== 3. Leg 3, title keywords: the weak leg, deliberately narrow ===\n");
check(
  "'price target' is an analyst action",
  ev.eventTypeFromTitle("Analyst raises Apple price target to $310") === "analyst"
);
check(
  "a rating change needs its preposition",
  ev.eventTypeFromTitle("Broker upgrades Tesla to Buy") === "analyst" &&
    ev.eventTypeFromTitle("Micron upgrades its Boise fab capacity") === null,
  "'upgrade' alone matches a factory story; anchoring to to/from is what separates them"
);
check(
  "a quarter word beside a results word is earnings",
  ev.eventTypeFromTitle("Oracle reports second-quarter results") === "earnings" &&
    ev.eventTypeFromTitle("Q3 revenue climbs 12% at ServiceNow") === "earnings"
);
check(
  "'to acquire' is a deal; the bare verb is not a pattern here",
  ev.eventTypeFromTitle("Broadcom to acquire VMware") === "deal" &&
    ev.eventTypeFromTitle("Costco acquires a new chief financial officer") === null,
  "'acquires' alone matches a hiring story"
);
check(
  "an ordinary headline yields null, which is the common and correct case",
  ev.eventTypeFromTitle("Apple unveils a thinner iPhone") === null &&
    ev.eventTypeFromTitle("Why Palantir stock fell today") === null
);
check(
  "THE TITLE LEG CANNOT PRODUCE 'macro'",
  [
    "Tariffs pressure Deere's margins",
    "Federal Reserve holds rates as Nvidia climbs",
    "Inflation data sends Tesla lower",
    "New EU regulation targets Meta",
  ].every((t) => ev.eventTypeFromTitle(t) !== "macro"),
  "on a per-symbol feed these are company stories with macro framing; calling them macro takes the picture away from the company"
);
check(
  "THE TITLE LEG CANNOT PRODUCE 'filing'",
  ["Micron's 10-Q reveals a margin squeeze", "What Tesla's 8-K really said", "Apple files S-1 for..."]
    .every((t) => ev.eventTypeFromTitle(t) !== "filing"),
  "leg 1 owns filings exactly; a headline mentioning a 10-Q is an article about its contents"
);
check(
  "the keyword list is small enough to read in one screen",
  (() => {
    const table = read("lib/server/news/eventType.ts").match(/const TITLE_EVENT_TYPES[\s\S]*?\n\];/)[0];
    const n = (table.match(/^\s*\[\//gm) ?? []).length;
    return n > 0 && n <= 14;
  })(),
  `${(read("lib/server/news/eventType.ts").match(/const TITLE_EVENT_TYPES[\s\S]*?\n\];/)[0].match(/^\s*\[\//gm) ?? []).length} patterns — §7 says keep it small, and this repo has a history with curated lists`
);
check(
  "all three adapters CALL the shared cascade",
  /deriveEventType\(\{[^}]*subjects/.test(readCodeOnly("lib/server/news/wireProvider.ts")) &&
    /eventType: deriveEventType\(\{ title \}\)\.eventType/.test(readCodeOnly("lib/server/news/gnewsProvider.ts")) &&
    /eventType: eventTypeFromForm\(/.test(readCodeOnly("lib/server/news/secProvider.ts")),
  "a positive check, because the negative one below passed happily while an adapter kept its own table under a different name"
);
check(
  "...and none of them keeps a pattern table of its own",
  ["wireProvider", "gnewsProvider", "secProvider"].every((m) => {
    const code = readCodeOnly(`lib/server/news/${m}.ts`);
    return !/\[\s*\/[^/\n]+\/i?\s*,\s*"(?:earnings|filing|analyst|deal|macro)"\s*\]/.test(code);
  }),
  "matches the SHAPE of a [regexp, eventType] table rather than one variable name, so renaming it does not evade this"
);

console.log("\n=== 4. The priority order, where the legs disagree ===\n");
check(
  "form beats subject AND title",
  ev.deriveEventType({
    form: "10-Q", items: "",
    subjects: ["Acquisitions"],
    title: "Company to acquire rival in definitive agreement",
  }).eventType === "earnings",
  "both weaker legs say 'deal' here; the form says the item is the quarterly report and the form wins"
);
check(
  "subject beats title",
  ev.deriveEventType({
    subjects: ["Earnings"],
    title: "Analyst raises price target",
  }).eventType === "earnings"
);
check(
  "title is used only when nothing stronger is present",
  ev.deriveEventType({ title: "Analyst raises price target" }).eventType === "analyst" &&
    ev.deriveEventType({ subjects: [], title: "Analyst raises price target" }).leg === "title"
);
check(
  "the leg is reported, so the measurement can name the evidence",
  ev.deriveEventType({ form: "8-K", items: "2.02" }).leg === "form" &&
    ev.deriveEventType({ subjects: ["Earnings"] }).leg === "subject" &&
    ev.deriveEventType({ title: "merger" }).leg === "title" &&
    ev.deriveEventType({ title: "nothing here" }).leg === null
);
check(
  "an empty form string does NOT enter the form leg",
  ev.deriveEventType({ form: "", title: "Analyst raises price target" }).leg === "title",
  "otherwise every non-SEC item would take the form leg's 'filing' floor and everything would be a filing"
);
check(
  "no inputs at all is null, not a default",
  ev.deriveEventType({}).eventType === null && ev.deriveEventType({}).leg === null
);

console.log("\n=== 5. null FALLS THROUGH TO SECTOR, never to an event bucket ===\n");
check(
  "an unclassifiable item selects on SECTOR",
  art.bucketForItem(null, "sector-semiconductors") === "sector-semiconductors",
  "the requirement this whole step is subordinate to: a generic illustration asserts nothing, a wrong event picture asserts something false"
);
check(
  "...and undefined behaves the same as null",
  art.bucketForItem(undefined, "sector-banks") === "sector-banks",
  "FMP items carry no eventType field at all, so undefined is the live case, not a theoretical one"
);
check(
  "null with no sector bucket either yields null, and the caller draws the generated card",
  art.bucketForItem(null, null) === null
);
check(
  "a real eventType DOES take the event bucket",
  art.bucketForItem("earnings", "sector-semiconductors") === "event-earnings"
);
check(
  "no eventType maps to a sector-* bucket, and no null maps to an event-* bucket",
  ALL_TYPES.every((t) => art.bucketForItem(t, "sector-software").startsWith("event-")) &&
    !String(art.bucketForItem(null, "sector-software")).startsWith("event-")
);

console.log("\n=== 6. Every eventType reaches art that EXISTS ===\n");
const manifest = JSON.parse(read("public/news-art/manifest.json"));
for (const t of ALL_TYPES) {
  const bucket = art.bucketForItem(t, null);
  check(
    `"${t}" -> ${bucket}, ${manifest[bucket] ?? 0} images`,
    typeof bucket === "string" && (manifest[bucket] ?? 0) > 0,
    t === "deal" || t === "filing" ? "the union is singular, the library is plural — this is the pair that breaks under `event-${eventType}`" : ""
  );
}
check(
  "the naive `event-${eventType}` really would have broken",
  !manifest["event-deal"] && !manifest["event-filing"] && manifest["event-deals"] > 0 && manifest["event-filings"] > 0,
  "a control: if the library is ever renamed to singular, this check stops being the reason the map exists"
);
check(
  "every event bucket's images all resolve to files on disk",
  ALL_TYPES.every((t) => {
    const bucket = art.bucketForItem(t, null);
    const n = manifest[bucket];
    for (let i = 1; i <= n; i += 1) {
      const stem = `public/news-art/${bucket}-${String(i).padStart(2, "0")}`;
      if (!fs.existsSync(path.join(ROOT, `${stem}.webp`)) || !fs.existsSync(path.join(ROOT, `${stem}-sm.webp`))) return false;
    }
    return true;
  }),
  "the 0-vs-1 index bug lived exactly here and failed no build"
);
// Re-load art.ts against a manifest with every event bucket REMOVED, which is
// the only honest way to test the degrade path: the real manifest has art for
// all five, so asking it nicely proves nothing.
const strippedManifest = Object.fromEntries(
  Object.entries(JSON.parse(read("public/news-art/manifest.json"))).filter(([k]) => !k.startsWith("event-"))
);
const artNoEvents = await loadTs(buildArtSrc(JSON.stringify(strippedManifest)), "art-noevents");
check(
  "the stripped manifest really has no event art (the control for the next check)",
  ALL_TYPES.every((t) => artNoEvents.bucketCount(`event-${t === "deal" ? "deals" : t === "filing" ? "filings" : t}`) === 0) &&
    artNoEvents.bucketCount("sector-banks") > 0
);
check(
  "an eventType whose bucket holds NO art falls through to sector, not to nothing",
  ALL_TYPES.every((t) => artNoEvents.bucketForItem(t, "sector-banks") === "sector-banks"),
  "the deliberate deviation from §6's literal rule: both branches are degenerate there, and sector art beats no art"
);
check(
  "...and with no sector bucket either it is still null, so the generated card draws",
  ALL_TYPES.every((t) => artNoEvents.bucketForItem(t, null) === null)
);

console.log("\n=== 7. The call site: taken is PER BUCKET ===\n");
const pageSrc = readCodeOnly("app/stock/[symbol]/news/page.tsx");
// THE SELECTION RULE MOVED into planCardArt in step 6b, so that a shared
// function and a shared component could be tested by RUNNING them — the source
// greps that used to live here passed happily while a page rendered nothing.
// scripts/check-news-art.mjs owns the per-bucket and per-item behaviour now;
// what belongs HERE is only that the page feeds eventType into the plan at all.
// ── THE LEAD CARDS MOVED TO planSymbolCardArt ON 2026-09-22 ──────────────
// The page now picks art in layers (article words -> event bucket -> industry
// -> sector), so its lead cards call planSymbolCardArt and its compact rows
// still call planCardArt. NOTHING these three assertions are about has changed:
// eventType is still per item, the plan is still built per item, and both
// callers still thread the same maps. The call name did, so the patterns do.
//
// scripts/check-news-art.mjs §10 owns what the LAYERS do; what belongs here is
// still only that the page feeds each item's own eventType into whatever plans
// its art — including that the new layer did not quietly drop it, which is the
// one way this change could have taken event art off the page.
const PLAN_CALL = "(?:planSymbolCardArt|planCardArt)";
check(
  "the page passes each item's OWN eventType into the plan",
  new RegExp(`${PLAN_CALL}\\(\\{[\\s\\S]{0,400}?eventType: item\\.eventType`).test(pageSrc),
  "a section-wide eventType, or none, would send every card to one bucket"
);
check(
  "the plan is built per item, not once per section",
  // 400, not 120: readCodeOnly BLANKS comments in place rather than deleting
  // lines, so a comment between the map and the call is that many spaces of
  // gap. The window still has to be bounded — an unbounded scan would satisfy
  // itself on the compact rows' call further down the file.
  new RegExp(`detailedNews\\.map\\(\\(item\\) =>[\\s\\S]{0,400}${PLAN_CALL}\\(`).test(pageSrc),
  "step 0 chose one bucket for the whole section; step 6 chooses per item"
);
check(
  "EVERY plan on the page threads the same no-repeat state",
  (() => {
    // Not "it appears somewhere": the lead cards and the compact rows each
    // build a plan, and one of them reverting to fresh state per card disables
    // the rule for that half while the other keeps the check passing.
    //
    // TWO COLLECTIONS SINCE THE LAYERED PICKER: the v1 buckets are keyed by
    // bucket plus a numeric index and the v2 library by image name, so they
    // cannot share one — but each must still be threaded, not rebuilt.
    const bucketUses = pageSrc.match(/taken(?:Buckets)?: [^,\n]+/g) ?? [];
    const nameUses = pageSrc.match(/takenNames: [^,\n]+/g) ?? [];
    return (
      bucketUses.length >= 2 &&
      bucketUses.every((u) => /: takenByBucket$/.test(u.trim())) &&
      nameUses.length >= 1 &&
      nameUses.every((u) => u.trim() === "takenNames: takenTagNames") &&
      /takenByBucket\s*=\s*new Map<string, Set<number>>\(\)/.test(pageSrc) &&
      /takenTagNames\s*=\s*new Set<string>\(\)/.test(pageSrc)
    );
  })(),
  "a fresh map per card disables the rule; check-news-art proves what the rule then does with it"
);
check(
  "pickArt's SELECTION rule is unchanged — only what it does when exhausted is now a choice",
  (() => {
    const artSrc = read("lib/server/news/art.ts");
    // THE THREE PARTS THAT ARE THE RULE, asserted individually rather than as
    // one signature match. The signature gained a fourth parameter on
    // 2026-09-22 — `onExhausted`, because a stock page draws five lead cards
    // against four-image pools and the fifth repeated. That is a change to the
    // LAST LINE of the function, not to how it picks: the hash, the 0-based
    // walk and the mutation of `taken` are what this check is about, and all
    // three are still here. Pinning the signature made the check fail on a
    // change it does not care about while proving nothing extra.
    return (
      /export function pickArt\(\n  bucket: string \| null,\n  key: string,\n  taken\?: Set<number>,/.test(artSrc) &&
      /const first = hashKey\(key\) % count;/.test(artSrc) &&
      /const index = \(first \+ step\) % count;/.test(artSrc) &&
      /taken\.add\(index\);/.test(artSrc)
    );
  })(),
  "re-hash-on-collision and the 0-based walk are untouched; the bucket handed to it and the exhausted branch are what changed"
);
check(
  "two items with different eventTypes draw from different buckets and do not block each other",
  (() => {
    const takenByBucket = new Map();
    const pick = (eventType, key) => {
      const bucket = art.bucketForItem(eventType, "sector-semiconductors");
      let taken = takenByBucket.get(bucket);
      if (!taken) { taken = new Set(); takenByBucket.set(bucket, taken); }
      return art.pickArt(bucket, key, taken);
    };
    const a = pick("earnings", "k1");
    const b = pick(null, "k1");
    return a.bucket === "event-earnings" && b.bucket === "sector-semiconductors";
  })()
);
check(
  "within ONE bucket the no-repeat rule still holds",
  (() => {
    const taken = new Set();
    const picks = ["a", "b", "c", "d"].map((k) => art.pickArt("event-earnings", k, taken));
    return new Set(picks.map((p) => p.src)).size === picks.length;
  })(),
  "event-earnings holds 5 images against 4 keys, so all four must differ"
);

console.log("\n=== 8. The flag, after step 7 ===\n");
const index = readCodeOnly("lib/server/news/index.ts");
check(
  "the default is free, and fmp is the explicit rollback",
  /process\.env\.NEWS_PROVIDER === "fmp" \? "fmp" : "free"/.test(index)
);
check(
  "no FMP item gains an eventType",
  !/eventType/.test(readCodeOnly("lib/server/news/fmpProvider.ts")),
  "FMP supplies no such field; inventing one would change today's live page"
);
check(
  "no AI call was added per item",
  !/openai|anthropic|generateText|aiSummar/i.test(readCodeOnly("lib/server/news/eventType.ts")),
  "§7 is pattern matching; a per-item model call is the cost the stored-news design exists to avoid"
);

// ─────────────────────────────────── 9. THE MEASUREMENT, over one real poll
console.log("\n=== 9. MEASUREMENT: which leg chooses the picture, over one real poll ===\n");
const digests = {
  gnews: readIf("scripts/fixtures/eventtype-gnews.jsonl"),
  wire: readIf("scripts/fixtures/eventtype-wire.jsonl"),
  sec: readIf("scripts/fixtures/eventtype-sec.jsonl"),
};
const missing = Object.entries(digests).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  check(`all three poll digests are committed`, false, `missing: ${missing.join(", ")} — run the relay task eventtype-sample`);
} else {
  const rows = Object.values(digests).flatMap((text) =>
    text.split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => JSON.parse(l))
  );

  // THE GNEWS ADAPTER STRIPS THE PUBLISHER SUFFIX BEFORE ANYTHING DOWNSTREAM
  // SEES THE TITLE, so the measurement has to strip it too or it is measuring a
  // string production never derives from. Loaded from the shipped adapter rather
  // than reimplemented.
  const gnewsSrc = read("lib/server/news/gnewsProvider.ts")
    .match(/export function stripPublisherSuffix\(title: string\): string \{[\s\S]*?\n\}/)[0]
    .replace("export function stripPublisherSuffix(title: string): string {", "export function stripPublisherSuffix(title) {");
  const { stripPublisherSuffix } = await loadTs(gnewsSrc, "strip");

  const tally = {};
  const byLeg = { form: 0, subject: 0, title: 0, null: 0 };
  const typeTally = {};
  for (const r of rows) {
    // SEC rows are aggregated by (form, items) and carry a count; every other
    // row is one item. Weighting by `n` is what makes the percentages describe
    // filings rather than distinct filing SHAPES.
    const weight = typeof r.n === "number" ? r.n : 1;
    const { eventType, leg } = ev.deriveEventType(
      r.src === "sec" ? { form: r.form, items: r.items }
      : r.src === "wire" ? { subjects: r.subjects, title: r.title }
      : { title: stripPublisherSuffix(r.title) }
    );
    byLeg[leg ?? "null"] += weight;
    tally[r.src] ??= { n: 0, form: 0, subject: 0, title: 0, null: 0 };
    tally[r.src].n += weight;
    tally[r.src][leg ?? "null"] += weight;
    if (eventType) typeTally[eventType] = (typeTally[eventType] ?? 0) + weight;
  }
  const total = Object.values(tally).reduce((a, t) => a + t.n, 0);
  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;

  console.log(`  ${total} items from one real poll\n`);
  console.log("  source      items    form  subject    title     null");
  for (const [src, t] of Object.entries(tally)) {
    console.log(`  ${src.padEnd(10)} ${String(t.n).padStart(5)}  ${String(t.form).padStart(6)} ${String(t.subject).padStart(8)} ${String(t.title).padStart(8)} ${String(t.null).padStart(8)}`);
  }
  console.log(`\n  BY LEG:  form ${byLeg.form} (${pct(byLeg.form)})  subject ${byLeg.subject} (${pct(byLeg.subject)})  ` +
              `title ${byLeg.title} (${pct(byLeg.title)})  null ${byLeg.null} (${pct(byLeg.null)})`);
  console.log(`  EVENT ART WOULD BE CHOSEN FOR ${total - byLeg.null} of ${total} items (${pct(total - byLeg.null)})`);
  const classified = total - byLeg.null;
  if (classified > 0) {
    console.log(`  OF THOSE, THE WEAK (TITLE) LEG CHOSE ${byLeg.title} (${((byLeg.title / classified) * 100).toFixed(1)}%)`);
  }
  console.log(`  TYPES: ${Object.entries(typeTally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}\n`);

  // ── THE POLL IS NOT THE PAGE, AND THE PAGE IS WHAT HAS PICTURES ──────────
  // The table above weights every polled item equally. A stock news page does
  // not: it shows 12 Google News headlines against the handful of filings the
  // SEC adapter's routine-form cap lets through (all material filings, plus at
  // most 3 insider rows), and the wires resolve to a universe symbol only 5% of
  // the time, so they contribute nothing per-symbol. Estimated per symbol from
  // the same digest, applying that cap:
  const ROUTINE = new Set(["3", "4", "5", "144"]);
  const perSymbol = { gnews: 0, secMaterial: 0, secRoutine: 0 };
  const bySymbol = new Map();
  for (const r of rows) {
    if (r.src === "gnews") perSymbol.gnews += 1;
    if (r.src !== "sec") continue;
    const bucket = bySymbol.get(r.symbol) ?? { material: 0, routine: 0 };
    if (ROUTINE.has(String(r.form).replace(/\/A$/, ""))) bucket.routine += r.n;
    else bucket.material += r.n;
    bySymbol.set(r.symbol, bucket);
  }
  for (const b of bySymbol.values()) {
    perSymbol.secMaterial += b.material;
    perSymbol.secRoutine += Math.min(3, b.routine);
  }
  const symbols = bySymbol.size;
  const pageSec = (perSymbol.secMaterial + perSymbol.secRoutine) / symbols;
  const pageGnews = perSymbol.gnews / symbols;
  const gnewsTitled = (tally.gnews.title / tally.gnews.n) * pageGnews;
  const pageTotal = pageSec + pageGnews;
  console.log(
    `  PER SYMBOL (the shape a stock page actually sees): ~${pageGnews.toFixed(1)} Google News + ` +
    `~${pageSec.toFixed(1)} filings = ~${pageTotal.toFixed(1)} items`
  );
  console.log(
    `  OF THOSE, event art on ~${(pageSec + gnewsTitled).toFixed(1)} (${(((pageSec + gnewsTitled) / pageTotal) * 100).toFixed(0)}%), ` +
    `and the TITLE leg chooses ~${gnewsTitled.toFixed(1)} of them ` +
    `(${((gnewsTitled / (pageSec + gnewsTitled)) * 100).toFixed(0)}% of the event art on a page)\n`
  );

  check("the poll is large enough to mean something", total >= 400, `${total} items`);
  check(
    "the weak title leg is NOT carrying most of the event art, on the poll or on a page",
    byLeg.title / Math.max(1, total - byLeg.null) < 0.25 &&
      gnewsTitled / Math.max(1, pageSec + gnewsTitled) < 0.25,
    "the question this measurement was built to answer; if this ever fails, the event buckets are being chosen by keyword matching and that is worth knowing before it ships"
  );
  check(
    "the SEC rows are weighted by their count, not treated as one item each",
    tally.sec && tally.sec.n === 320,
    "108 aggregated shapes stand for 320 real filings; counting shapes would understate the form leg by 3x"
  );
  check(
    "every SEC item is classified, and by the form leg",
    tally.sec && tally.sec.null === 0 && tally.sec.form === tally.sec.n,
    "the form leg has a truthful floor, so it never abstains"
  );
  check(
    "Google News items are classified by the title leg ONLY",
    tally.gnews && tally.gnews.form === 0 && tally.gnews.subject === 0,
    "a headline is the only signal that feed carries"
  );
  check(
    "most Google News headlines are left null rather than guessed at",
    tally.gnews && tally.gnews.null > tally.gnews.title,
    `${tally.gnews?.null}/${tally.gnews?.n} null — a title leg that classified most headlines would be one matching too loosely`
  );
  check(
    "no event type is assigned that has no art",
    Object.keys(typeTally).every((t) => (manifest[art.bucketForItem(t, null)] ?? 0) > 0),
    Object.keys(typeTally).join(", ")
  );
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
