// The company's own description, from its annual filing — locate and clean.
//
// Brief 2026-09-22 PR 3. FMP's description is their authored prose and the
// last FMP field on /stock/[symbol]. This replaces it with the company's own
// words: 10-K Item 1 "Business", or 20-F Item 4.B "Business Overview".
//
// PURE AND NETWORK-FREE. The relay probe (scripts/sec-description-probe.mjs)
// lifts it to measure; the eventual refresh job will call the same functions,
// so what the owner reviewed is what renders. Nothing renders from it yet.
//
// ── THE OWNER'S FILTERS (step 2, #518), APPLIED TO EVERY FILER ─────────────
//   1. join broken lines and collapse whitespace                  (ABVX)
//   2. strip a leading all-caps heading                           (GEV "INTRODUCTION.")
//   3. drop leading definition text — "In this report, the terms…",
//      "When used in this report…", "…refers to X and its subsidiaries"
//                                                                 (KO, BAC, ONDS)
//   4. REJECT a cross-reference or the financial discussion outright —
//      "incorporated herein by reference", "set forth under the headings",
//      "in conjunction with our … financial statements",
//      "Management's Discussion"                                  (ONDS, AZN)
//   5. keep ≤ ~2 paragraphs / ~900 characters, cut at a sentence end;
//      require ≥ ~200 characters after cleaning
//   6. not found or rejected → NO description, and no FMP fallback

const ENT: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", bull: "•", reg: "®", trade: "™", copy: "©",
};

/** Filing HTML to text with paragraph breaks. Drops the iXBRL header and hidden blocks. */
export function filingText(html: string): string {
  return html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<([a-z]+)[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

// ── LOCATING THE SECTION ──────────────────────────────────────────────────
//
// HEADINGS ARE WHOLE LINES. An inline "see Item 4.B. Business Overview" in a
// risk factor is a cross-reference, not the section (ABEV and ARM, relay
// 35775513697). A heading may also be split over two lines — "Item 1." then
// "Business" — which a single-line pattern misses.
//
// THE SECTION RUNS FROM ITS HEADING TO THE NEXT ITEM'S. For a 10-K that is
// Item 1 → Item 1A (or 1B / 2 where a smaller filer omits 1A). The table of
// contents carries the same pair a few lines apart, so a pair whose body is a
// few hundred characters is the TOC and is skipped.
//
// A HEADING IS COMPARED BY ITS LETTERS AND DIGITS ONLY, and the whole line must
// be the heading. Two misses in relay 35780665288 fixed by that:
//   ONDS  — its forward-looking-statements note has a wrapped line beginning
//           "Item 1A “Risk Factors,” and Item 7 …". A prefix match took that as
//           the end of Item 1, so the TOC's Item 1 paired with it and the
//           "section" was the TOC and the cautionary note (MD&A wording). The
//           real pair is "Item 1. Business" @15k → "Item 1A. Risk Factors" @83k.
//   BRK.B — its filing splits words mid-way: "Item 1. Busines s Description",
//           "Item 1A. Ris k Factors". Letters-only, those are exact headings.

type Line = { text: string; key: string; start: number; end: number };

function lines(text: string): Line[] {
  const out: Line[] = [];
  let at = 0;
  for (const t of text.split("\n")) {
    out.push({ text: t.trim(), key: t.toLowerCase().replace(/[^a-z0-9]/g, ""), start: at, end: at + t.length });
    at += t.length + 1;
  }
  return out;
}

const ITEM1 = /^item1(business(es)?(description|overview)?)?$/;
const BUSINESS = /^business(es)?(description|overview)?$/;
const ITEM1_END = /^item(1a(riskfactors)?|1b(unresolvedstaffcomments)?|2((descriptionof)?properties)?)$/;
const ITEM4B = /^(item4)?bbusinessoverview$/;
const ITEM4C = /^(item4)?corgani[sz]ationalstructure$/;

/** A table-of-contents pair is closer than this; a real section is longer. */
const MIN_SECTION_CHARS = 1500;

export type Located = { found: true; body: string } | { found: false; why: string };

export function locateSection(text: string, form: string): Located {
  const L = lines(text);
  const isStart = (i: number): { ok: boolean; bodyFrom: number } => {
    const k = L[i].key;
    if (form === "20-F") return { ok: ITEM4B.test(k), bodyFrom: L[i].end };
    const m = ITEM1.exec(k);
    if (!m) return { ok: false, bodyFrom: 0 };
    if (m[1]) return { ok: true, bodyFrom: L[i].end };
    // "Item 1." alone: the heading continues on the next non-empty line.
    let j = i + 1;
    while (j < L.length && !L[j].text) j++;
    return j < L.length && BUSINESS.test(L[j].key) ? { ok: true, bodyFrom: L[j].end } : { ok: false, bodyFrom: 0 };
  };
  const isEnd = (k: string) => (form === "20-F" ? ITEM4C.test(k) : ITEM1_END.test(k));

  if (!["10-K", "10-K405", "10-KT", "20-F"].includes(form)) {
    return { found: false, why: form === "40-F"
      ? "40-F: the business description is in the AIF exhibit, not the primary document"
      : `no section heading defined for ${form}` };
  }
  const starts = L.map((_, i) => i).filter((i) => isStart(i).ok);
  if (!starts.length) return { found: false, why: "heading not found" };
  const ends = L.map((l, i) => (isEnd(l.key) ? i : -1)).filter((i) => i >= 0);

  // THE LAST START BEFORE EACH END, pairs tried in document order; the first
  // pair long enough to be a section, not a TOC entry, wins.
  for (const e of ends) {
    const before = starts.filter((s) => s < e);
    if (!before.length) continue;
    const s = before[before.length - 1];
    const from = isStart(s).bodyFrom;
    const body = text.slice(from, L[e].start).trim();
    if (body.length >= MIN_SECTION_CHARS) return { found: true, body };
  }
  // No closing heading at all (some 20-F layouts): the last start, bounded.
  if (!ends.length) {
    const s = starts[starts.length - 1];
    const from = isStart(s).bodyFrom;
    const body = text.slice(from, from + 8000).trim();
    if (body.length >= MIN_SECTION_CHARS) return { found: true, body };
  }
  return { found: false, why: `heading found ${starts.length}x, every candidate section was a table of contents` };
}

// ── CLEANING ──────────────────────────────────────────────────────────────

/** Rule 4: text that is a cross-reference or the financial discussion. */
const REJECT: [RegExp, string][] = [
  [/incorporated\s+(herein\s+)?by\s+reference/i, "incorporated by reference"],
  [/set\s+forth\s+under\s+the\s+headings?/i, "set forth under the headings"],
  [/in\s+conjunction\s+with\s+(our|the)\s+[^.]{0,80}financial\s+statements/i, "in conjunction with the financial statements"],
  [/management['’]s\s+discussion/i, "Management's Discussion"],
];

/** Rule 3: definition sentences. Dropped wherever they open the text. */
const DEFINITION: RegExp[] = [
  /^in\s+this\s+(annual\s+)?report\b/i,
  /^when\s+used\s+in\s+this\s+(annual\s+)?report\b/i,
  /^unless\s+(otherwise\s+indicated|the\s+context)/i,
  /^as\s+used\s+(in\s+this|herein)/i,
  /^when\s+we\s+use\s+the\s+terms?\b/i,                                       // GS, paragraph 2
  // A reading instruction, not a cross-reference to other text in its place:
  // ONDS opens Item 1 with "This business description should be read in
  // conjunction with our audited Consolidated Financial Statements…", then the
  // real overview. Dropped while leading; anywhere else rule 4 still rejects it.
  /^this\s+(business\s+description|section|item)\s+should\s+be\s+read\s+in\s+conjunction\s+with\b/i,
  /^(the\s+terms?\s+)?[“"][^”"]+[”"][^.]{0,200}\brefers?\s+to\b/i,
  // ".{0,160}?" not "[^.]": the name inside carries a period (ONDS "Ondas Inc. and its subsidiaries").
  /\brefers?\s+to\s+.{0,160}?\band\s+(all\s+)?(of\s+)?its\s+(consolidated\s+)?subsidiaries\b/i,
  /^the\s+use\s+of\s+the\s+(words?|terms?)\b/i,                               // ONDS
  /^(all\s+)?references\s+(to|in)\b[^.]{0,200}\b(are\s+to|refer\s+to|mean)\b/i,   // GS "References to “this Form 10-K” are to…"
];

/** A sentence ends at . ! ? or : , optionally inside a closing quote or bracket.
 * A bare closing quote does not: ONDS wraps after "“our,”". */
const SENTENCE_END = /[.!?:][”"’)]*$/;

/** A line at least this long that stops mid-sentence is a hard wrap, not a heading. */
const WRAPPED_LINE_CHARS = 40;

/** Pointers elsewhere in the document — dropped as sentences, wherever they sit. */
const POINTER: RegExp[] = [
  /^(please\s+)?see\s+/i,                                                   // V "Please see Our Core Business discussion below."
  /\bterms\s+used\s+in\s+this\s+(section|report)\s+are\s+defined\b/i,          // PLAB glossary pointer
  // Contact details, not a description (PLAB, BAC).
  /\bprincipal\s+executive\s+offices?\b/i,
  /\b(our\s+)?website\s+(address\s+)?is\b/i,
];

export const DESCRIPTION_MAX_CHARS = 900;
export const DESCRIPTION_MIN_CHARS = 200;

export type Cleaned = { ok: true; text: string } | { ok: false; why: string };

/** Split into sentences, keeping the terminator. Abbreviations like "Inc." survive
 * because a split needs a following capital or quote AND a preceding lowercase
 * letter, digit or closing bracket. */
function sentences(p: string): string[] {
  return p.split(/(?<=[a-z0-9)”"’][.!?])\s+(?=[A-Z“"])/).map((s) => s.trim()).filter(Boolean);
}

export function cleanDescription(body: string): Cleaned {
  // Rule 1: JOIN A BROKEN LINE, NOT EVERY LINE. Filings end most paragraphs
  // with a single newline (one </p> or </div>), so joining every newline would
  // glue sub-headings like "Overview" onto the prose. A line is broken when it
  // does not end a sentence and either the next begins lower-case or a digit,
  // or the line itself is prose-length (a hard-wrapped filing, ONDS / KTOS /
  // GEV / PLAB on relay 35781008070, wraps before capitals too: "…to the" /
  // "United States…"). A sub-heading is short, so it is not joined forward.
  const raw = body.split(/\n+/).map((l) => l.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])(?=\s|$)/g, "$1").trim()).filter(Boolean);
  let paras: string[] = [];
  let lastLine = "";
  for (const l of raw) {
    const prev = paras[paras.length - 1];
    const open = prev && !SENTENCE_END.test(prev);
    // A heading ends on a capitalised word ("Our Strategy", "General"); a line
    // ending on a lower-case word ("…focus is on the") is a wrap (KTOS).
    const wrapped = lastLine.length >= WRAPPED_LINE_CHARS || /(^|\s)[a-z]+,?$/.test(lastLine);
    if (open && (/^[a-z0-9(]/.test(l) || wrapped)) paras[paras.length - 1] = `${prev} ${l}`;
    else paras.push(l);
    lastLine = l;
  }
  // Sub-headings and fragments ("General", "Overview", a stray ".").
  paras = paras.filter((p) => p.length >= 60 && /[a-z]/.test(p));
  if (!paras.length) return { ok: false, why: "no prose after the heading" };

  // Rule 2: a leading all-caps heading glued to the first paragraph.
  paras[0] = paras[0].replace(/^[A-Z][A-Z0-9 &,'’\-]{2,}[.:]\s+(?=[A-Z])/, "");
  // …and headings glued INSIDE one line, betrayed by the last heading word
  // opening the sentence too: AAPL "Products iPhone iPhone ® is…" → "iPhone ® is…".
  paras = paras.map((p) => p.replace(/^(?:[A-Z][\w’'&-]*\s+){0,4}?([A-Za-z][\w’'-]*)\s+(?=\1\b)/, ""));

  // Rule 3: drop definition sentences. Leading ones first (the owner's rule);
  // on relay 35781008070 GS carried "When we use the terms…" as its SECOND
  // paragraph, so a definition is dropped wherever it falls in the excerpt,
  // and so is a pointer to elsewhere in the document.
  const out: string[] = [];
  for (const p of paras) {
    const ss = sentences(p).filter((s) => !DEFINITION.some((re) => re.test(s)) && !POINTER.some((re) => re.test(s)));
    if (ss.length) out.push(ss.join(" "));
  }
  if (!out.length) return { ok: false, why: "only definition text after the heading" };

  // Rule 5: at most two paragraphs and ~900 characters, cut at a sentence end.
  const kept: string[] = [];
  let n = 0;
  for (const p of out.slice(0, 2)) {
    const ss = sentences(p);
    const take: string[] = [];
    for (const s of ss) {
      if (n + s.length + 1 > DESCRIPTION_MAX_CHARS && (kept.length || take.length)) break;
      take.push(s);
      n += s.length + 1;
    }
    if (take.length) kept.push(take.join(" "));
    if (n >= DESCRIPTION_MAX_CHARS) break;
  }
  // A paragraph that stops mid-sentence (a wrap the join could not see, or a
  // colon introducing a list that was cut) ends at its last full sentence; one with no full sentence is dropped.
  const whole = kept
    .map((p) => (/[.!?][”"’)]*$/.test(p) ? p : p.replace(/(^|[.!?][”"’)]*)[^.!?]*$/, "$1").trim()))
    .filter((p) => p.length >= 60);
  const text = whole.join("\n\n").trim();

  // Rule 4, on what would render.
  for (const [re, label] of REJECT) if (re.test(text)) return { ok: false, why: `rejected: ${label}` };
  if (text.length < DESCRIPTION_MIN_CHARS) return { ok: false, why: `too short after cleaning (${text.length} chars)` };
  return { ok: true, text };
}
