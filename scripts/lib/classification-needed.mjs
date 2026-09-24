// "Classification needed" helper, the pure half (Relay B, #553 COWORK #3).
//
// Lists universe symbols A's resolver cannot fully place (no sector or no
// industry) plus A's SIC-change notices, with a SUGGESTED {sector, industry}
// from the resolver's own label set for the owner to approve. The owner's
// approval lands in data/sec/classification-overrides.json BY PR; this helper
// never writes that file.
//
// Imports nothing but the spelling helper, so the check loads it in bare Node.
import { lookupSpellingIn } from "../../lib/symbolSpellings.mjs";

export const ISSUE_TITLE = "Classification needed";

/**
 * Resolve exactly as lib/server/staticProfile.sicProfileFor does (A's):
 * 10-K override -> SIC table row -> 2-digit major group's sector -> none.
 */
export function resolveTaxonomy(symbol, { overrides, registrants, classification }) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const o = lookupSpellingIn(overrides, sym)?.value;
  if (o && (o.sector || o.industry)) return { sector: o.sector ?? null, industry: o.industry ?? null, sic: lookupSpellingIn(registrants, sym)?.value?.sic ?? null };
  const sic = lookupSpellingIn(registrants, sym)?.value?.sic ?? null;
  if (!sic) return { sector: null, industry: null, sic: null };
  const row = classification.codes[sic];
  return {
    sector: row?.sector ?? (row ? null : classification.majorGroups[sic.slice(0, 2)] ?? null),
    industry: row?.industry ?? null,
    sic,
  };
}

const WORD = /[a-z]{4,}/g;
const STOP = new Set(["company", "companies", "services", "products", "other", "general", "including", "holdings", "group", "corporation", "incorporated", "limited", "global", "leading", "provider", "providers", "based", "which", "their", "through", "segment", "segments"]);
const words = (s) => new Set((String(s ?? "").toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(ies|es|s)$/, "")));

/**
 * A suggestion FROM THE LABEL SET ONLY, never free text: the known sector's
 * industries (or all labels when the sector is unknown), scored by shared words
 * with the filing's own description and SEC's SIC wording. No match -> no
 * suggestion, rather than a guess dressed as one.
 */
export function suggestLabel({ sector, sicText, description }, labels) {
  const evidence = new Set([...words(sicText), ...words(description)]);
  // With no sector to narrow it, one shared word across 144 labels is noise
  // (Accenture scored "Asset Management" on "management"): ask for two.
  const floor = sector ? 1 : 2;
  let best = null;
  for (const [industry, labelSector] of Object.entries(labels)) {
    if (sector && labelSector !== sector) continue;
    const score = [...words(industry)].filter((w) => evidence.has(w)).length;
    if (score >= floor && (!best || score > best.score)) best = { sector: labelSector, industry, score };
  }
  return best ? { sector: best.sector, industry: best.industry } : sector ? { sector, industry: null } : null;
}

/** Table-safe, link-free, one line. The repo is public: no URL leaves here. */
export function cell(s, max = 140) {
  const clean = String(s ?? "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/@/g, "(at)")
    .replace(/[|\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean || "—";
}

/** The company, not the instrument: "Alcoa Corporation Common Stock" -> "Alcoa Corporation". */
export const companyName = (s) =>
  s ? String(s).replace(/\s*[-–]?\s*(Class [A-Z0-9]+ )?(Common Stock|Ordinary Shares|American Depositary Shares|Capital Stock)\b.*$/i, "").trim() || String(s) : null;

export const firstSentence = (text) => String(text ?? "").split(/(?<=[.!?])\s+/)[0] ?? "";

export function buildRows(universe, data, notices = {}) {
  const missing = [];
  for (const symbol of universe) {
    const t = resolveTaxonomy(symbol, data);
    if (t.sector && t.industry) continue;
    const description = firstSentence(lookupSpellingIn(data.descriptions, symbol)?.value?.[3]);
    missing.push({
      symbol,
      name: companyName(lookupSpellingIn(data.names, symbol)?.value ?? null),
      sic: t.sic,
      have: t,
      description,
      suggestion: suggestLabel({ sector: t.sector, sicText: t.sic ? data.classification.codes[t.sic]?.sec ?? null : null, description }, data.classification.labels),
    });
  }
  const changed = Object.values(notices)
    .filter((n) => n && n.symbol)
    .map((n) => {
      const nowRow = data.classification.codes[n.now];
      return {
        symbol: n.symbol,
        name: companyName(lookupSpellingIn(data.names, n.symbol)?.value ?? null),
        was: n.was,
        now: n.now,
        secDescription: n.description ?? null,
        have: resolveTaxonomy(n.symbol, data),
        suggestion: nowRow?.sector ? { sector: nowRow.sector, industry: nowRow.industry ?? null } : null,
        seenOn: n.seenOn ?? null,
      };
    });
  return { missing, changed };
}

/** GitHub refuses an issue body over 65,536 characters; stay well inside it. */
export const MAX_ROWS = 150;
export const MAX_BODY = 60_000;

const fmt = (t) => (t ? `${t.sector ?? "—"} / ${t.industry ?? "—"}` : "—");

/** The issue body, or null when there is nothing to classify (close the issue). */
export function issueBody({ missing, changed }, asOf, universeSize) {
  if (!missing.length && !changed.length) return null;
  const lines = [
    `Checked ${universeSize} Pickers universe symbols on ${asOf}. The resolver (10-K override, then SIC table) could not fully place the ones below.`,
    "",
    "To approve a row, add it to data/sec/classification-overrides.json in a PR. This helper never edits that file; it rewrites this issue daily and closes it when the list is empty.",
    "",
  ];
  if (missing.length) {
    lines.push(`### No sector or industry (${missing.length})`, "", "| Symbol | Company | SIC | Filing says | Has now | Suggested |", "|---|---|---|---|---|---|");
    for (const r of missing.slice(0, MAX_ROWS)) lines.push(`| ${cell(r.symbol, 12)} | ${cell(r.name, 40)} | ${cell(r.sic, 6)} | ${cell(r.description)} | ${cell(fmt(r.have), 50)} | ${cell(fmt(r.suggestion), 60)} |`);
    if (missing.length > MAX_ROWS) lines.push("", `…and ${missing.length - MAX_ROWS} more, listed on the next runs as these are resolved.`);
    lines.push("");
  }
  if (changed.length) {
    lines.push(`### SIC code changed at SEC (${changed.length})`, "", "| Symbol | Company | SIC was → now | SEC wording | Has now | Suggested |", "|---|---|---|---|---|---|");
    for (const r of changed) lines.push(`| ${cell(r.symbol, 12)} | ${cell(r.name, 40)} | ${cell(r.was, 6)} → ${cell(r.now, 6)} | ${cell(r.secDescription, 60)} | ${cell(fmt(r.have), 50)} | ${cell(fmt(r.suggestion), 60)} |`);
    lines.push("");
  }
  lines.push("_Generated daily by the Classification needed helper (Relay B)._");
  const body = lines.join("\n");
  return body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}\n\n…truncated to fit an issue.` : body;
}

/** What to do with the issue: create, update, close or nothing. */
export function issueAction(existing, body) {
  if (body === null) return existing ? { kind: "close" } : { kind: "none" };
  if (!existing) return { kind: "create" };
  return existing.body === body ? { kind: "none" } : { kind: "update" };
}
