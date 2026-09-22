// What the topic classifier does to a sample of REAL headlines it was not
// written against.
//
// ── WHY A SEPARATE SCRIPT AND NOT A CHECK ──────────────────────────────────
// scripts/check-news-art.mjs asserts things that must never stop being true. A
// match RATE is not one of those: it moves with the feed, and pinning it to a
// threshold would produce a check that fails for a reason nobody can act on.
// This prints numbers for a person to read and record, in the same shape as
// scripts/eventtype-sample.mjs.
//
// ── THE NUMBER IN THE BRIEF WAS FITTED, AND THIS IS THE ANTIDOTE ───────────
// The draft table was written while looking at the 50 headlines live on
// /headlines on 2026-09-21 and then measured on those same 50: 58% subject
// matches. That is an upper bound, not a rate. The fixture used here was
// captured 2026-09-13, before the table existed, which is the whole point of
// using it.
//
// WHAT IT IS NOT: it is the PER-SYMBOL Google News feed (16 symbols x 12
// headlines), not the general feed /headlines shows. It over-represents
// single-company copy and under-represents macro. Read the numbers as
// "the table on company headlines", and re-run on a general-feed capture
// before quoting a rate for the page.
//
//   node scripts/newsart-topic-sample.mjs
import fs from "node:fs";
import path from "node:path";
import { articleTopic, SUBJECT_TAGS, MOTIF_TAGS } from "../lib/server/news/articleTopic.ts";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// THE ADAPTER STRIPS THE PUBLISHER SUFFIX BEFORE ANYTHING DOWNSTREAM SEES THE
// TITLE, so measuring the raw fixture string would measure a string production
// never classifies. Taken from the shipped adapter rather than reimplemented,
// the same way check-event-type.mjs does it.
const stripSrc = read("lib/server/news/gnewsProvider.ts")
  .match(/export function stripPublisherSuffix\(title: string\): string \{[\s\S]*?\n\}/)[0]
  .replace("export function stripPublisherSuffix(title: string): string {", "export function stripPublisherSuffix(title) {");
const { stripPublisherSuffix } = await import(
  `data:text/javascript;base64,${Buffer.from(stripSrc).toString("base64")}`
);

const rows = read("scripts/fixtures/eventtype-gnews.jsonl")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => JSON.parse(l));

const subjectTally = Object.fromEntries(SUBJECT_TAGS.map((t) => [t, 0]));
const motifTally = Object.fromEntries(MOTIF_TAGS.map((t) => [t, 0]));
const buckets = { subject: 0, motifOnly: 0, nothing: 0 };
const matched = [];

for (const row of rows) {
  const title = stripPublisherSuffix(row.title);
  const { subjects, motifs } = articleTopic(title, null);

  for (const s of subjects) subjectTally[s] += 1;
  for (const m of motifs) motifTally[m] += 1;

  if (subjects.length) buckets.subject += 1;
  else if (motifs.length) buckets.motifOnly += 1;
  else buckets.nothing += 1;

  if (subjects.length || motifs.length) {
    matched.push({ symbol: row.symbol, title, tags: [...subjects, ...motifs.map((m) => `+${m}`)].join(" ") });
  }
}

const total = rows.length;
const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;

console.log(`\n=== scripts/fixtures/eventtype-gnews.jsonl — ${total} real headlines, captured 2026-09-13 ===\n`);
console.log(`  subject matched   ${String(buckets.subject).padStart(4)}  ${pct(buckets.subject)}`);
console.log(`  motif only        ${String(buckets.motifOnly).padStart(4)}  ${pct(buckets.motifOnly)}`);
console.log(`  nothing           ${String(buckets.nothing).padStart(4)}  ${pct(buckets.nothing)}`);

const live = (tally) => Object.entries(tally).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
const dead = (tally) => Object.entries(tally).filter(([, n]) => n === 0).map(([t]) => t);

console.log(`\n  subjects fired: ${live(subjectTally).map(([t, n]) => `${t}=${n}`).join(" ") || "none"}`);
console.log(`  subjects silent on this sample: ${dead(subjectTally).join(" ") || "none"}`);
console.log(`\n  motifs fired:   ${live(motifTally).map(([t, n]) => `${t}=${n}`).join(" ") || "none"}`);
console.log(`  motifs silent on this sample:   ${dead(motifTally).join(" ") || "none"}`);

// ── EVERY MATCH, PRINTED ───────────────────────────────────────────────────
// Precision is the thing that matters here and it cannot be counted: a picture
// is wrong when it asserts something the article does not say, which only a
// person reading the pair can tell. So the whole matched set is printed rather
// than a sample of it -- the brief asks for ~20 checked by eye and there is no
// reason to make someone re-run the script with a different slice to see them.
console.log(`\n=== every match, for the precision read-through (${matched.length}) ===\n`);
for (const m of matched) {
  console.log(`  ${m.tags.padEnd(26)} ${m.symbol.padEnd(6)} ${m.title}`);
}
console.log();
