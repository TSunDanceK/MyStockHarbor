// THE /stock/[symbol]/news LEAD PARAGRAPH, RUN RATHER THAN READ.
//
// ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
// Found by the owner on the 2026-09-21 preview, /stock/AAPL/news:
//
//     "Earnings tone is currently mixed earnings tone."
//
// The sentence was `Earnings tone is currently ${earningsScore.label
// .toLowerCase()}.` and the label is a complete noun phrase built for a chip
// ("Mixed earnings tone"). It was wrong on EVERY band and EVERY symbol, plus a
// fourth way in the no-headlines case ("...currently no clear earnings read").
//
// ── WHY READING THE LINE DID NOT CATCH IT ─────────────────────────────────
// The clause immediately before interpolates newsScore.label identically and is
// CORRECT, because scoreToNewsLabel returns a bare adjective ("Bullish"). Two
// scorers returned different parts of speech under one field name, `label`, and
// the types could not say so. That is why this check RUNS the builder over
// every band instead of asserting the source looks right.
//
// EVERY ASSERTION IS PAIRED WITH A MUTATION. An assertion against correct
// source proves only that it did not throw.
import fs from "node:fs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const NEWS = "app/stock/[symbol]/news/page.tsx";
const DATA = "lib/stock-news-data.ts";
const newsRaw = fs.readFileSync(NEWS, "utf8");
const dataRaw = fs.readFileSync(DATA, "utf8");

const unexport = (s) => (s ?? "").replace(/^export /gm, "");
const grabTable = (src, name) =>
  unexport((src.match(new RegExp(`^export const ${name}[^=]*=[\\s\\S]*?\\n\\];`, "m")) ?? [""])[0]);

/**
 * The vocabulary and the sentence, lifted together.
 *
 * `mutate` edits the concatenated source before it is imported, which is how a
 * mutation re-runs the REAL builder against a broken rule rather than against a
 * hand-written imitation of one.
 */
const liftCopy = (mutate = (s) => s) =>
  lift(
    mutate(
      [
        grabTable(dataRaw, "EARNINGS_TONE_BANDS"),
        unexport((dataRaw.match(/^export const earningsBand = [\s\S]*?;$/m) ?? [""])[0]),
        unexport(grabFunction(dataRaw, "scoreToEarningsWord")),
        unexport(grabFunction(dataRaw, "scoreToEarningsLabel")),
        grabFunction(newsRaw, "buildLeadSummary"),
      ].join("\n")
    ) +
      "\nexport { buildLeadSummary, scoreToEarningsWord, scoreToEarningsLabel, earningsBand, EARNINGS_TONE_BANDS };",
    "",
    "news-lead-copy"
  );

const M = await liftCopy();

/** The lead paragraph for one earnings score, through the shipped builder. */
const leadFor = (M, score, over = {}) =>
  M.buildLeadSummary({
    symbol: "MU",
    companyName: "Micron Technology",
    trend: "Uptrend",
    newsScore: { label: "Bullish" },
    earningsScore: {
      score,
      tone: "yellow",
      label: M.scoreToEarningsLabel(score),
      word: M.scoreToEarningsWord(score),
      reason: "",
      ...over,
    },
  });

console.log("\n1. the sentence never says its own noun twice");
{
  // EVERY BAND AND BOTH SIDES OF EVERY BOUNDARY. The owner saw this on MIXED;
  // asserting only MIXED would leave the other two to be found the same way.
  const scores = [100, 80, 64, 63, 50, 37, 36, 20, 0];
  const bad = scores.filter((s) => /earnings tone is currently .*earnings tone/i.test(leadFor(M, s)));
  check("no band produces 'Earnings tone is currently <x> earnings tone'",
    bad.length === 0,
    bad.length ? `bands still stammering at scores: ${bad.join(", ")}` : `checked ${scores.length} scores`);

  // AND IT STILL SAYS SOMETHING. A fix that deleted the clause would also pass
  // the assertion above, which is the failure mode of a negative-only test.
  const missing = scores.filter((s) => !/Earnings tone is currently \w+\./.test(leadFor(M, s)));
  check("...and every band still states a tone",
    missing.length === 0,
    missing.length ? `no tone sentence at: ${missing.join(", ")}` : "");

  const words = [...new Set(scores.map((s) => M.scoreToEarningsWord(s)))].sort();
  check("the three bands produce three distinct words",
    words.length === 3, words.join(", "));

  // THE MUTATION: put the label back where the word belongs.
  const stammer = await liftCopy((s) =>
    s.replace("`Earnings tone is currently ${earningsScore.word}.`",
              "`Earnings tone is currently ${earningsScore.label.toLowerCase()}.`"));
  check("MUTATION: interpolating the label brings the stammer back",
    /earnings tone is currently mixed earnings tone/i.test(leadFor(stammer, 50)),
    "if this passes clean, the assertion above is not reading the sentence");
}

console.log("\n2. no earnings read is not a tone of 'mixed'");
{
  // A NULL WORD TAKES A DIFFERENT SENTENCE. The old code put the label through
  // the same slot and produced "Earnings tone is currently no clear earnings
  // read." -- a fourth way of being wrong, and the one that reads as a bug
  // rather than as a stammer.
  const none = leadFor(M, 50, { label: "No clear earnings read", word: null });
  check("a null word does not claim a tone",
    !/Earnings tone is currently/.test(none), none.slice(none.lastIndexOf(". ") + 2));
  check("...and says so plainly instead of rendering a blank",
    /no clear earnings read/i.test(none) && !/currently \./.test(none),
    none.slice(none.lastIndexOf(". ") + 2));
  check("...and never reads as the mixed band",
    !/currently mixed/i.test(none));
}

console.log("\n3. the null trend still drops its clause");
{
  // PRE-EXISTING BEHAVIOUR, ASSERTED BECAUSE THIS CHANGE EDITS THE SAME
  // FUNCTION. "A null trend is not a 'mixed backdrop', it is no backdrop" is
  // the rule the file already states, and it is the same rule §2 applies to
  // the earnings clause -- so a regression here would be this change's fault.
  const noTrend = M.buildLeadSummary({
    symbol: "MU", companyName: "Micron Technology", trend: null,
    newsScore: { label: "Neutral" },
    earningsScore: { score: 50, tone: "yellow", label: M.scoreToEarningsLabel(50), word: M.scoreToEarningsWord(50), reason: "" },
  });
  check("no trend means no backdrop clause", !/backdrop/.test(noTrend));
  check("...and the sentence still reads", /headline tone\./.test(noTrend),
    noTrend.slice(0, 90));
}

console.log("\n4. one table owns the thresholds, the words and the labels");
{
  // ── THE CONSOLIDATION THIS PINS ───────────────────────────────────────
  // The three label strings and the 64/36 thresholds existed TWICE: in
  // scoreToEarningsLabel and again as an inline if/else inside scoreEarnings.
  // They agreed, which is the only reason nobody noticed. Adding a third form
  // (the bare word) to two copies would have been three.
  const scoreEarnings = grabFunction(dataRaw, "scoreEarnings");
  check("scoreEarnings reads the band table",
    /const band = earningsBand\(score\)/.test(scoreEarnings),
    "it must not re-derive the band from its own numbers");
  check("...and carries no second copy of the thresholds",
    !/score >= 64/.test(scoreEarnings) && !/score <= 36/.test(scoreEarnings),
    "a duplicated threshold agrees until someone moves one of them");
  check("...and no second copy of the label strings",
    !/label = "(Positive|Weak|Mixed) earnings tone"/.test(scoreEarnings));

  // THE BOUNDARIES ARE UNCHANGED BY THE CONSOLIDATION. This is the real risk
  // of rewriting an if/else chain as a table: the table is ordered high-to-low
  // and `>= from`, where the original was `>= 64` / `<= 36`, so the mixed band
  // has to start at 37 and not at 36.
  const boundaries = [
    [64, "positive"], [63, "mixed"], [37, "mixed"], [36, "weak"],
  ];
  const wrong = boundaries.filter(([s, w]) => M.scoreToEarningsWord(s) !== w);
  check("the band boundaries are exactly where the if/else chain had them",
    wrong.length === 0,
    wrong.length ? wrong.map(([s, w]) => `${s} wanted ${w}, got ${M.scoreToEarningsWord(s)}`).join("; ") : "64/37 split preserved");

  // LABEL AND WORD CANNOT DISAGREE ABOUT WHICH BAND A SCORE IS IN, for any
  // score at all -- that is the property having one table is FOR.
  const disagree = [];
  for (let s = 0; s <= 100; s++) {
    const band = M.earningsBand(s);
    if (M.scoreToEarningsLabel(s) !== band.label || M.scoreToEarningsWord(s) !== band.word) {
      disagree.push(s);
    }
    if (!band.label.toLowerCase().startsWith(band.word)) disagree.push(`${s}:mismatch`);
  }
  check("label and word agree on the band for every score 0-100",
    disagree.length === 0, disagree.slice(0, 6).join(", "));

  check("every band carries a threshold, a word, a label and a tone",
    M.EARNINGS_TONE_BANDS.length === 3 &&
      M.EARNINGS_TONE_BANDS.every((b) =>
        typeof b.from === "number" && b.word && b.label && b.tone),
    M.EARNINGS_TONE_BANDS.map((b) => `${b.from}:${b.word}`).join(" "));
}

console.log(
  failures === 0
    ? "\nThe news lead paragraph reads correctly in every band."
    : `\n${failures} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
