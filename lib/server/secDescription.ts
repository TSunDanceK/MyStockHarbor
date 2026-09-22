// The company's own description, from its annual filing — locate and clean.
//
// Brief 2026-09-22 PR 3. FMP's description is their authored prose and the
// last FMP field on /stock/[symbol]. This replaces it with the company's own
// words: 10-K Item 1 "Business", or 20-F Item 4.B "Business Overview".
//
// PURE AND NETWORK-FREE. The relay probe (scripts/sec-description-probe.mjs)
// and the universe build (scripts/sec-descriptions-build.mjs → the committed
// data/sec/descriptions.json the page reads) both lift these functions, so
// what the owner reviewed is what renders.
//
// THREE LAYERS OF RULES: the owner's filters below (step 2), the owner's
// round-3 and render decisions on #518 (marked "Owner, #518"), and rules found
// reading every row of the full build (marked "Full build"). The last layer
// only ever drops text; none of it changed a row of the approved sample.
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

// ── 20-F: ITEM 4 "INFORMATION ON THE COMPANY" → 4.B "BUSINESS OVERVIEW" ────
//
// Owner, #518: find Item 4 first, then its 4.B inside it. Diagnostic relay
// 35785563715 read the three misses:
//   ABEV  — sub-headings are a letter on its own line ("A." / "Selected
//           Financial Data"), so "B." / "Business Overview" is split too.
//   TSM   — "ITEM 4. INFORMATION ON THE COMPANY", sub-headings unlettered.
//   RYAAY — Item 4 has NO Business Overview sub-heading at all (Introduction,
//           Strategy, Route System, …); "Business Overview" appears only under
//           Item 5. Inside Item 4 or nowhere, so RYAAY has no description.
// Inside Item 4 an UNLETTERED "Business Overview" is accepted; outside it
// (a filing whose Item 4 heading is not found) only a lettered 4.B is, since
// an unlettered one can be Item 5's (RYAAY).
const ITEM4 = /^item4(informationonthecompany)?$/;
const ITEM4_TITLE = /^informationonthecompany$/;
const ITEM4_END = /^item(4a|5)[a-z]*$/;
const ITEM4B_LETTERED = /^(item4)?bbusinessoverview$/;
const ITEM4B_ANY = /^(item4)?b?businessoverview$/;
const B_ALONE = /^(item4)?b$/;
const BUSINESS_OVERVIEW = /^businessoverview$/;
const ITEM4C = /^(item4)?c?organi[sz]ationalstructure$/;
const C_ALONE = /^(item4)?c$/;
const ORG_STRUCTURE = /^organi[sz]ationalstructure$/;
/** A heading line is short; a long line that happens to fold to a pattern is prose. */
const HEADING_KEY_MAX = 80;

/** A table-of-contents pair is closer than this; a real section is longer. */
const MIN_SECTION_CHARS = 1500;

export type Located = { found: true; body: string } | { found: false; why: string };

/** Index of the next non-empty line after i, or -1. */
function nextLine(L: Line[], i: number, hi: number): number {
  let j = i + 1;
  while (j < hi && !L[j].text) j++;
  return j < hi ? j : -1;
}

/** A heading on line i — whole, or split over two lines ("Item 1." / "Business",
 * "B." / "Business Overview"). Returns where its body starts, or -1. */
function headingAt(L: Line[], i: number, hi: number, whole: RegExp, prefix?: RegExp, rest?: RegExp): number {
  const k = L[i].key;
  if (k.length > HEADING_KEY_MAX) return -1;
  if (whole.test(k) && !(prefix && prefix.test(k))) return L[i].end;
  if (prefix && rest && prefix.test(k)) {
    const j = nextLine(L, i, hi);
    return j >= 0 && rest.test(L[j].key) ? L[j].end : -1;
  }
  return -1;
}

type Span = { from: number; to: number };

/** THE LAST START BEFORE EACH END, pairs tried in document order; the first
 * pair long enough to be a section, not a TOC entry, wins. With no end at all,
 * the last start runs to `openEnd` (a bound, or the enclosing section's end). */
function pairSection(
  L: Line[], lo: number, hi: number,
  startAt: (i: number) => number, isEnd: (i: number) => boolean,
  minChars: number, openEnd: (from: number) => number,
): { span: Span | null; starts: number } {
  const starts: [number, number][] = [];
  const ends: number[] = [];
  for (let i = lo; i < hi; i++) {
    const b = startAt(i);
    if (b >= 0) starts.push([i, b]);
    else if (isEnd(i)) ends.push(i);
  }
  if (!starts.length) return { span: null, starts: 0 };
  for (const e of ends) {
    const before = starts.filter(([s]) => s < e);
    if (!before.length) continue;
    const [, from] = before[before.length - 1];
    if (L[e].start - from >= minChars) return { span: { from, to: L[e].start }, starts: starts.length };
  }
  const [s, from] = starts[starts.length - 1];
  if (!ends.some((e) => e > s)) {
    const to = openEnd(from);
    if (to - from >= minChars) return { span: { from, to }, starts: starts.length };
  }
  return { span: null, starts: starts.length };
}

export function locateSection(text: string, form: string): Located {
  if (!["10-K", "10-K405", "10-KT", "20-F"].includes(form)) {
    return { found: false, why: form === "40-F"
      ? "40-F: the business description is in the AIF exhibit, not the primary document"
      : `no section heading defined for ${form}` };
  }
  const L = lines(text);
  const n = L.length;
  const bounded = (from: number) => Math.min(text.length, from + 8000);
  const found = (span: Span | null): Located | null => {
    const body = span ? text.slice(span.from, span.to).trim() : "";
    return body.length >= MIN_SECTION_CHARS ? { found: true, body } : null;
  };

  if (form !== "20-F") {
    const r = pairSection(L, 0, n, (i) => headingAt(L, i, n, ITEM1, /^item1$/, BUSINESS),
      (i) => L[i].key.length <= HEADING_KEY_MAX && ITEM1_END.test(L[i].key), MIN_SECTION_CHARS, bounded);
    return found(r.span) ?? { found: false, why: r.starts
      ? `heading found ${r.starts}x, every candidate section was a table of contents`
      : "heading not found" };
  }

  // 20-F. Item 4 first.
  const item4 = pairSection(L, 0, n, (i) => headingAt(L, i, n, ITEM4, /^item4$/, ITEM4_TITLE),
    (i) => L[i].key.length <= HEADING_KEY_MAX && ITEM4_END.test(L[i].key), MIN_SECTION_CHARS, bounded);
  if (item4.span) {
    const lo = L.findIndex((l) => l.start >= item4.span!.from);
    const hiIdx = L.findIndex((l) => l.start >= item4.span!.to);
    const hi = hiIdx < 0 ? n : hiIdx;
    const r = pairSection(L, lo, hi,
      (i) => headingAt(L, i, hi, ITEM4B_ANY, B_ALONE, BUSINESS_OVERVIEW),
      (i) => headingAt(L, i, hi, ITEM4C, C_ALONE, ORG_STRUCTURE) >= 0,
      MIN_SECTION_CHARS, () => item4.span!.to);
    return found(r.span) ?? { found: false, why: r.starts
      ? "Item 4 found; its Business Overview is shorter than a section"
      : "Item 4 found, but it has no Business Overview heading" };
  }
  // Item 4's own heading not read: a LETTERED 4.B anywhere, as before.
  const r = pairSection(L, 0, n,
    (i) => headingAt(L, i, n, ITEM4B_LETTERED, B_ALONE, BUSINESS_OVERVIEW),
    (i) => headingAt(L, i, n, ITEM4C, C_ALONE, ORG_STRUCTURE) >= 0,
    MIN_SECTION_CHARS, bounded);
  return found(r.span) ?? { found: false, why: r.starts
    ? `heading found ${r.starts}x, every candidate section was a table of contents`
    : "heading not found" };
}

// ── CLEANING ──────────────────────────────────────────────────────────────

/** Rule 4: text that is a cross-reference or the financial discussion. */
const REJECT: [RegExp, string][] = [
  [/incorporated\s+(herein\s+)?by\s+reference/i, "incorporated by reference"],
  [/set\s+forth\s+under\s+the\s+headings?/i, "set forth under the headings"],
  [/in\s+conjunction\s+with\s+(our|the)\s+[^.]{0,80}financial\s+statements/i, "in conjunction with the financial statements"],
  [/management['’]s\s+discussion/i, "Management's Discussion"],
  // Full build: PSA and SAFE opened Item 1 with safe-harbor boilerplate.
  [/forward-looking\s+statements|safe\s+harbor/i, "forward-looking statements"],
];

/** Rule 3: definition sentences. Dropped wherever they open the text. */
const DEFINITION: RegExp[] = [
  /^in\s+this\s+(annual\s+)?report\b/i,
  // "In this Form 10-K, references to …" (AXS, MXL, RNR on the full build).
  /^(in|as\s+used\s+in)\s+this\s+(annual\s+report\s+on\s+)?form\s+\d+-[a-z]+\b/i,
  /^when\s+used\s+in\s+this\s+(annual\s+)?report\b/i,
  /^unless\s+(otherwise\s+indicated|the\s+context)/i,
  /^as\s+used\s+(in\s+this|herein)/i,
  /^when\s+we\s+use\s+the\s+terms?\b/i,
  // Full build: MGM "… is referred to as the “Company,” … and together with its subsidiaries …".
  /\b(is|are)\s+(collectively\s+)?referred\s+to\s+(herein\s+)?as\b/i,                                       // GS, paragraph 2
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

/** A first paragraph shorter than this, with a longer one after it, is a slogan. */
const SLOGAN_CHARS = 100;

/** A capital or digit ("3D Systems"), optionally inside an opening quote, or a camel-case brand (AAPL "iPhone®"). */
const STARTS_LIKE_A_SENTENCE = /^([“"‘']?[A-Z0-9]|[a-z]+[A-Z])/;

const QUOTED = /[“"‘][^”"’]{1,60}[”"’]/g;

/** A parenthetical that names the company: ≥2 quoted names, or ≥2 of we/us/our. */
function isNameList(inner: string): boolean {
  const quoted = (inner.match(QUOTED) ?? []).length;
  const pronouns = new Set((inner.toLowerCase().match(/\b(we|us|our)\b/g) ?? [])).size;
  return quoted >= 2 || pronouns >= 2;
}

export const DESCRIPTION_MAX_CHARS = 900;
/** No single sentence of an overview runs this long; one that does is a list. */
const MAX_SENTENCE_CHARS = 1000;

/**
 * FULL-BUILD RULES (a975c007 → the render commit). Found reading every row of
 * the first universe build, not on the owner's 31-symbol sample; each names the
 * rows that motivated it. They only DROP text — a row they touch keeps fewer
 * sentences or has no description, never new wording.
 */
/**
 * Sentences ABOUT THE REPORT, not the company — dropped wherever they fall
 * (full build: AMR, BKD, CBL, CE, AWR "this Annual Report on Form 10-K …";
 * DAL, NWL, SPB, T, TBB website and SEC-availability text; ACGL, AXS "amounts
 * are in millions"; CELH, MTDR, RNR glossary pointers; FLNG a footnote).
 */
const META: RegExp[] = [
  /\bthis\s+(annual\s+)?report\b|\bthis\s+form\s+\d+-[a-z]+\b|\bthis\s+document\b/i,
  /\bwebsite\b|www\.|https?:\/\/|free\s+of\s+charge|securities\s+and\s+exchange\s+commission|\bthe\s+sec\b/i,
  /\btabular\b|amounts\s+(are\s+)?in\s+(thousands|millions|billions)|\bin\s+(thousands|millions),\s+except\b|rounding\s+differences/i,
  /\bglossary\b|\bdefined\s+terms?\b|\bdefinitions?\s+of\b|capitalized\s+terms/i,
  /^\(\d+\)|^\*/,
  /^(throughout\s+this\s+document|unless\s+(the\s+)?context\s+(otherwise\s+)?(requires|indicates)|unless\s+otherwise\s+(specified|noted|indicated|stated))/i,
];

/** A table or roster read as a sentence: FLNG's charter table, DAL's officer list. */
function isTabular(s: string): boolean {
  const digits = (s.match(/\d/g) ?? []).length;
  return digits / s.length > 0.12 || /\bAge:?\s*\d{2}\b/.test(s);
}
export const DESCRIPTION_MIN_CHARS = 200;

export type Cleaned = { ok: true; text: string } | { ok: false; why: string };

/** Split into sentences, keeping the terminator. Abbreviations like "Inc." survive
 * because a split needs a following capital or quote AND a preceding lowercase
 * letter, digit or closing bracket. */
function sentences(p: string): string[] {
  return p.split(/(?<=[a-z0-9)”"’][.!?])\s+(?=[A-Z“"])/).map((s) => s.trim()).filter(Boolean);
}

/** Lower-case words of a name or a paragraph opening, punctuation dropped, a leading "the" removed. */
function nameWords(s: string): string[] {
  const w = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  return w[0] === "the" ? w.slice(1) : w;
}

/**
 * Does the paragraph open with a TRAILING FRAGMENT of the company's name —
 * GS "Group Inc. is a bank holding company…" against "GOLDMAN SACHS GROUP INC"?
 * The full name, or its leading words ("Bank of America is…"), is not a
 * fragment; only a proper suffix is, which reads as a defined short name whose
 * definition was stripped.
 */
export function opensWithNameFragment(paragraph: string, companyName: string): boolean {
  const name = nameWords(companyName);
  const head = nameWords(paragraph.slice(0, 120));
  for (let len = name.length - 1; len >= 1; len--) {
    const suffix = name.slice(name.length - len);
    if (suffix.every((w, i) => head[i] === w) && head.length > len) return true;
  }
  return false;
}

export type CleanOptions = {
  /** The registrant's name as SEC holds it (submissions `name`), for the name-fragment rule. */
  companyName?: string | null;
};

export function cleanDescription(body: string, opts: CleanOptions = {}): Cleaned {
  // Rule 1: JOIN A BROKEN LINE, NOT EVERY LINE. Filings end most paragraphs
  // with a single newline (one </p> or </div>), so joining every newline would
  // glue sub-headings like "Overview" onto the prose. A line is broken when it
  // does not end a sentence and either the next begins lower-case or a digit,
  // or the line itself is prose-length (a hard-wrapped filing, ONDS / KTOS /
  // GEV / PLAB on relay 35781008070, wraps before capitals too: "…to the" /
  // "United States…"). A sub-heading is short, so it is not joined forward.
  const raw = body.split(/\n+/).map((l) => l.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])(?=\s|$)/g, "$1").trim()).filter(Boolean);
  // Each paragraph remembers whether the one before it stopped mid-sentence:
  // a paragraph that CONTINUES an unfinished one is a fragment, whatever its
  // first letter (KTOS "…Kratos is known as the" / "United States and its
  // allies, to address…", relay 35781418181).
  type Para = { t: string; follows: boolean };
  let paras: Para[] = [];
  let lastLine = "";
  for (const l of raw) {
    const prev = paras[paras.length - 1];
    const open = Boolean(prev) && !SENTENCE_END.test(prev.t);
    // A heading ends on a capitalised word ("Our Strategy", "General"); a line
    // ending on a lower-case word ("…focus is on the") is a wrap (KTOS).
    const wrapped = lastLine.length >= WRAPPED_LINE_CHARS || /(^|\s)[a-z]+,?$/.test(lastLine);
    // A name on its own line, then the sentence it opens: "Bausch Health
    // Companies Inc." / "is a global, diversified …" (BHC, full build). The
    // name ends in a period, so SENTENCE_END alone would split them.
    const nameLine = Boolean(prev) && /^[a-z]/.test(l) && /\b(Inc|Corp|Ltd|Co|Cos|plc|LLC|L\.P|N\.V|S\.A|S\.E|AG|SE|SA|NV)\.$/.test(prev.t);
    if ((open && (/^[a-z0-9(]/.test(l) || wrapped)) || nameLine) prev.t = `${prev.t} ${l}`;
    else paras.push({ t: l, follows: open && prev.t.length >= 60 });
    lastLine = l;
  }
  // Sub-headings and fragments ("General", "Overview", a stray ".").
  paras = paras.filter((p) => p.t.length >= 60 && /[a-z]/.test(p.t));
  if (!paras.length) return { ok: false, why: "no prose after the heading" };

  // Rule 2: a leading all-caps heading glued to the first paragraph.
  paras[0].t = paras[0].t.replace(/^[A-Z][A-Z0-9 &,'’\-]{2,}[.:]\s+(?=[A-Z])/, "");
  // …and headings glued INSIDE one line, betrayed by the last heading word
  // opening the sentence too: AAPL "Products iPhone iPhone ® is…" → "iPhone ® is…".
  for (const p of paras) p.t = p.t.replace(/^(?:[A-Z][\w’'&-]*\s+){0,4}?([A-Za-z][\w’'-]*)\s+(?=\1\b)/, "");

  // Owner, #518: STRIP A BRACKETED NAME LIST — the parenthetical that defines
  // what the company will be called: ONDS "(together with its subsidiaries,
  // the “Company,” “Ondas,” “we,” “us,” or “our”)", BRK.B "(“Berkshire,”
  // “Company” or “Registrant”)", GEV "(the Company, GE Vernova, our, we, or
  // us)". Two or more quoted names, or two or more of we/us/our, marks one. A
  // single quoted abbreviation — (“OAS”), ("IBD"), (“AI”) — defines a term,
  // not the company, and stays.
  let nameDefinitionStripped = false;
  for (const p of paras) {
    p.t = p.t.replace(/\s*\(([^()]*)\)/g, (m, inner: string) => {
      if (!isNameList(inner)) return m;
      nameDefinitionStripped = true;
      return "";
    });
  }

  // Full build: an embedded ", which we (sometimes) refer to as “Celldex,”
  // “we,” … or the “Company,”" clause is cut from an otherwise good lede
  // (CLDX, EBC); the sentence stays.
  for (const p of paras) {
    p.t = p.t.replace(/,\s*which\s+we\s+(sometimes\s+)?refer\s+to\s+(herein\s+)?as\s+((the\s+)?[“"][^”"]{1,40}[”"],?\s*((or|and)\s+)?)+/gi, () => {
      nameDefinitionStripped = true;
      return ", ";
    });
  }

  // Owner, #518: no space before ® or ™ (AAPL "iPhone ®").
  for (const p of paras) p.t = p.t.replace(/\s+([®™])/g, "$1");

  // Rule 3: drop definition sentences. Leading ones first (the owner's rule);
  // on relay 35781008070 GS carried "When we use the terms…" as its SECOND
  // paragraph, so a definition is dropped wherever it falls in the excerpt,
  // and so is a pointer to elsewhere in the document.
  let out: Para[] = [];
  for (const p of paras) {
    const all = sentences(p.t);
    // A DROPPED SENTENCE STILL COUNTS FOR REJECTION: AZN's cross-reference is a
    // single 1,000+ character sentence, and dropping it as a run-on let the
    // text after it render (full build). A section that points elsewhere is
    // rejected whole, whichever rule would have removed the pointer.
    // Only in the LEADING paragraphs (before two are kept), and only for the
    // sentences the length and table rules drop: the section's later pages
    // mention MD&A as a matter of course.
    if (out.length < 2) {
      for (const x of all) {
        // Not the DEFINITION drops: ONDS's leading "should be read in
        // conjunction with…" sentence is dropped, not rejected (owner, #518).
        if (x.length <= MAX_SENTENCE_CHARS && !isTabular(x) && !META.some((re) => re.test(x))) continue;
        for (const [re, label] of REJECT) if (re.test(x)) return { ok: false, why: `rejected: ${label}` };
      }
    }
    // A "sentence" past MAX_SENTENCE_CHARS is a list or a run-on definition, not
    // prose: AFL's executive-officer roster, AXS's subsidiary list (full build).
    const ss = all.filter((s) => !DEFINITION.some((re) => re.test(s)) && !POINTER.some((re) => re.test(s)) &&
      !META.some((re) => re.test(s)) && s.length <= MAX_SENTENCE_CHARS && !isTabular(s));
    if (all.some((s) => DEFINITION.some((re) => re.test(s)))) nameDefinitionStripped = true;
    if (ss.length) out.push({ t: ss.join(" "), follows: p.follows });
  }
  if (!out.length) return { ok: false, why: "only definition text after the heading" };

  // Owner, #518 (render): ONCE A NAME LIST OR DEFINITION WAS STRIPPED, a later
  // paragraph that opens with a bare fragment of the company's name is dropped:
  // it leans on the definition that is gone (GS "Group Inc. is a bank holding
  // company…", after "When we use the terms … we mean The Goldman Sachs Group,
  // Inc. (Group Inc. …)" was dropped).
  if (nameDefinitionStripped && opts.companyName) {
    const name = opts.companyName;
    out = out.filter((p, i) => i === 0 || !opensWithNameFragment(p.t, name));
  }

  // Full build: a FIRST paragraph that opens mid-sentence ("is a global …")
  // is a fragment too; the next one that starts like a sentence leads.
  const lead = out.findIndex((p) => STARTS_LIKE_A_SENTENCE.test(p.t));
  out = lead < 0 ? [] : out.slice(lead);
  if (!out.length) return { ok: false, why: "no paragraph starts like a sentence" };

  // Owner, #518: A LEADING ONE-LINE SLOGAN is dropped when a longer paragraph
  // follows (RKLB "Our Mission: We Open Access to Space to Improve Life on Earth.").
  if (out.length > 1 && out[0].t.length < SLOGAN_CHARS && out[1].t.length > out[0].t.length) out = out.slice(1);

  // Owner, #518: A SECOND PARAGRAPH ONLY IF IT STARTS LIKE A SENTENCE — a
  // capital letter (optionally inside an opening quote), not a bullet, and not
  // the continuation of a paragraph that stopped mid-sentence (KTOS, ONDS "● OAS…").
  if (out.length > 1 && !(STARTS_LIKE_A_SENTENCE.test(out[1].t) && !out[1].follows)) out = out.slice(0, 1);

  // Rule 5: at most two paragraphs and ~900 characters, cut at a sentence end.
  const kept: string[] = [];
  let n = 0;
  for (const p of out.slice(0, 2)) {
    const ss = sentences(p.t);
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
