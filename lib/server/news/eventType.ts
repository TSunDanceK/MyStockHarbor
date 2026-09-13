// What kind of event an article reports.
//
// Step 6 of claude/news-adapter-spec-2026-09-13.md, §7. Pure functions: no I/O,
// no network, no per-item AI call.
//
// ── WHY THIS IS ONE FILE ───────────────────────────────────────────────────
// Three adapters feed it and each has a different signal available, so the
// temptation is to put each adapter's rule in that adapter. The priority order
// is the whole point of §7 though — it says which evidence wins when two
// disagree — and a priority order split across three files is a priority order
// nobody can read. Every pattern in the cascade lives here.
//
// ── WHAT eventType COSTS WHEN IT IS WRONG ──────────────────────────────────
// It selects the picture. A non-null value sends the card to an event-* bucket
// INSTEAD of the symbol's sector bucket, so a wrong value puts event-earnings
// art on a lawsuit story — which asserts something false, where a generic
// sector illustration asserts nothing. null is not a failure here; it is the
// correct answer whenever the evidence is thin, and it falls through to sector.
import type { NewsItem } from "./types";

export type EventType = NonNullable<NewsItem["eventType"]>;

/** Which leg of the cascade produced a value. For measurement, not for render. */
export type EventTypeLeg = "form" | "subject" | "title";

// ───────────────────────────────────────────────────────── LEG 1: SEC FORM TYPE
//
// THE STRONGEST SIGNAL IN THE SET, and the only one that cannot be wrong in the
// way the others can. A filing's form is assigned by the filer under penalty of
// perjury; it is not a text match. It is also the only leg with a truthful
// floor: when the form says nothing more specific, "filing" is still literally
// what the item is, so this leg never has to guess and never returns null.

/** 8-K item codes specific enough to outrank the bare form. */
const ITEM_EVENT_TYPES: Record<string, EventType> = {
  // Results of operations — this IS the earnings release, and on most large caps
  // the 8-K carrying it lands before the 10-Q does.
  "2.02": "earnings",
  "1.01": "deal", // material agreement entered
  "1.02": "deal", // material agreement terminated
  "2.01": "deal", // acquisition or disposition completed
  "5.01": "deal", // change in control
};

const FORM_EVENT_TYPES: Array<[RegExp, EventType]> = [
  // The periodic reports ARE the earnings disclosure.
  [/^10-K/i, "earnings"],
  [/^10-Q/i, "earnings"],
  // Ownership: a 13D is an activist stake, a 13G a passive one. Both are deals
  // in the sense that matters for a picture — someone is buying the company.
  //
  // BOTH SPELLINGS, AND THE MEASUREMENT IS WHY. This pattern was written as
  // /^SC 13[DG]/ from the form names EDGAR's own documentation uses. The real
  // submissions API writes "SCHEDULE 13G" — 19 filings across 8 of the 16
  // sampled symbols, every one of which silently fell through to "filing".
  // Nothing failed; the cards would just have shown filing art for an
  // ownership stake, forever, with no way to notice from the code.
  [/^(?:SC|SCHEDULE) 13[DG]/i, "deal"],
  [/^SC TO-/i, "deal"], // tender offer
  [/^DEFM14A/i, "deal"], // merger proxy, as opposed to the annual one
];

/**
 * Leg 1. Never returns null: "filing" is the truthful floor for anything filed.
 *
 * Item codes are read BEFORE the form because they are strictly more specific —
 * every 8-K is "a current report" and that tells a reader nothing, while Item
 * 2.02 on the same filing says it is the quarterly numbers.
 */
export function eventTypeFromForm(form: string, items: string): EventType {
  const codes = String(items ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  for (const code of codes) {
    const type = ITEM_EVENT_TYPES[code];
    if (type) return type;
  }

  const clean = String(form ?? "").trim();
  for (const [pattern, type] of FORM_EVENT_TYPES) {
    if (pattern.test(clean)) return type;
  }

  return "filing";
}

// ──────────────────────────────────────────────── LEG 2: WIRE SUBJECT ELEMENTS
//
// Structured, issuer-supplied, and measured present on the real PR Newswire
// feed. Weaker than a form type because the issuer picks the label for their
// own marketing reasons, but it is a fixed vocabulary rather than free prose.
// Moved here verbatim from wireProvider so the whole cascade reads in one place.

const SUBJECT_EVENT_TYPES: Array<[RegExp, EventType]> = [
  [/earning|quarterly result|annual result|financial result/i, "earnings"],
  [/dividend|stock split|buyback|share repurchase/i, "earnings"],
  [/acquisition|merger|joint venture|takeover|divestiture|licensing/i, "deal"],
  [/analyst|rating|price target|coverage/i, "analyst"],
  [/sec filing|prospectus|proxy|8-k|10-q|10-k/i, "filing"],
  [/economic|regulat|policy|trade show|government|tariff/i, "macro"],
];

/** Leg 2. null when no subject matches — most wire items carry no usable one. */
export function eventTypeFromSubjects(subjects: string[]): EventType | null {
  for (const [pattern, type] of SUBJECT_EVENT_TYPES) {
    if (subjects.some((s) => pattern.test(s))) return type;
  }
  return null;
}

// ───────────────────────────────────────────────────── LEG 3: TITLE KEYWORDS
//
// ── THE WEAK LEG, AND THIS REPO HAS A HISTORY WITH CURATED LISTS ───────────
// It also carries most of the volume, because Google News is the per-symbol
// primary and a headline is all it gives. That combination — weakest evidence,
// largest share — is the reason this list is deliberately SHORT and biased
// hard towards returning null.
//
// TWO EVENT TYPES ARE DELIBERATELY UNREACHABLE FROM A TITLE:
//
//   "filing" — leg 1 owns it and owns it exactly. A headline containing "10-Q"
//   is usually an article ABOUT a filing's contents, which is an earnings story.
//
//   "macro"  — on a per-symbol feed, a headline mentioning the Fed or tariffs is
//   almost always a company story with macro framing ("Tariffs pressure Deere's
//   margins"). Labelling that "macro" asserts the article is about the economy
//   and takes the picture away from the company. There is no title pattern that
//   distinguishes the two, so there is no pattern here.
//
// Every pattern below requires a phrase that has essentially one meaning in a
// financial headline. Single words that look decisive are not enough: "upgrade"
// alone matches "upgrades its data centre capacity", and "acquires" alone
// matches "acquires a new CEO".
const TITLE_EVENT_TYPES: Array<[RegExp, EventType]> = [
  // Analyst actions. "price target" is the highest-precision phrase in news
  // headlines generally; the rating words are anchored to the preposition that
  // makes them a rating change rather than a product improvement.
  [/\bprice target\b/i, "analyst"],
  // THE OBJECT SITS BETWEEN THE VERB AND THE PREPOSITION in real headlines
  // ("upgrades Tesla to Buy"), so the preposition cannot be anchored adjacent
  // to the verb — the first draft of this pattern required that and matched
  // nothing at all. Anchored to an actual RATING WORD instead, which is what
  // separates a rating change from "upgrades its Boise fab capacity".
  [/\b(?:up|down)grade[sd]?\b[^.]{0,40}\bto\s+(?:strong\s+)?(?:buy|sell|hold|neutral|outperform|underperform|overweight|underweight|equal[-\s]?weight|market\s+perform|sector\s+perform)\b/i, "analyst"],
  [/\binitiat(?:es|ed|ing)\s+coverage\b/i, "analyst"],
  [/\b(?:buy|sell|hold|outperform|overweight|underweight|neutral)\s+rating\b/i, "analyst"],

  // Earnings. Anchored to a period word next to a results word, which is how
  // earnings headlines are written and how nothing else is.
  [/\bQ[1-4]\b[^.]{0,24}\b(?:earnings|results|revenue|profit|loss)\b/i, "earnings"],
  [/\b(?:first|second|third|fourth)[-\s]quarter\b/i, "earnings"],
  [/\bearnings\s+(?:call|report|results|beat|miss|preview|per share)\b/i, "earnings"],
  [/\bbeats?\b[^.]{0,20}\bestimates?\b/i, "earnings"],

  // Deals. "to acquire" and "definitive agreement" are near-unambiguous; the
  // bare verb "acquires" is not, and is not here.
  [/\bto\s+acquire\b/i, "deal"],
  [/\bto\s+be\s+acquired\s+by\b/i, "deal"],
  [/\bdefinitive\s+(?:merger\s+)?agreement\b/i, "deal"],
  [/\bmerger\b/i, "deal"],
];

/** Leg 3. null is the expected answer for most headlines and that is correct. */
export function eventTypeFromTitle(title: string): EventType | null {
  const text = String(title ?? "");
  if (!text) return null;
  for (const [pattern, type] of TITLE_EVENT_TYPES) {
    if (pattern.test(text)) return type;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────── THE CASCADE

export type EventTypeInputs = {
  /** SEC only. */
  form?: string | null;
  items?: string | null;
  /** Wires only: prn:subject and dc:subject, already cleaned. */
  subjects?: string[];
  /** Everything with a headline. */
  title?: string | null;
};

/**
 * §7's priority order, in one place: form → subject → title.
 *
 * Returns the leg as well as the value so the measurement can say WHICH
 * evidence chose each picture. That distinction is the point: if the title leg
 * is carrying most of the volume then most event art is being selected by the
 * weakest signal in the set, and the honest response to that is to know it.
 */
export function deriveEventType(inputs: EventTypeInputs): {
  eventType: EventType | null;
  leg: EventTypeLeg | null;
} {
  if (inputs.form) {
    return { eventType: eventTypeFromForm(inputs.form, inputs.items ?? ""), leg: "form" };
  }

  const fromSubject = eventTypeFromSubjects(inputs.subjects ?? []);
  if (fromSubject) return { eventType: fromSubject, leg: "subject" };

  const fromTitle = eventTypeFromTitle(inputs.title ?? "");
  if (fromTitle) return { eventType: fromTitle, leg: "title" };

  // NOT a default bucket. null means the card selects on sector, which asserts
  // nothing about what the article says.
  return { eventType: null, leg: null };
}
