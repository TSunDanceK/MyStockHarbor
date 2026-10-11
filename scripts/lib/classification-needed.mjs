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
 * A suggestion FROM THE LABEL SET ONLY, never free text, and ONLY INSIDE A
 * KNOWN SECTOR (#553 COWORK #23): no sector, no suggestion. Within the sector,
 * industries are scored by shared words with the filing's own description and
 * SEC's SIC wording.
 *
 * SIC WORDING ALONE IS NOT EVIDENCE OF AN INDUSTRY. The 2026-09-24 dry run
 * suggested "Other Precious Metals" for FCX, RIO, VALE, HBM and HWM on the one
 * word "metal" from SIC 1000 / 3350 ("Metal Mining"), none of them with a
 * stored description. Scoping to the sector cannot stop that -- all five ARE
 * Basic Materials -- so an industry needs a word from the filer's own
 * description, or two shared words in all. Otherwise the sector alone is
 * offered, which is what is actually known.
 */
export function suggestLabel({ sector, sicText, description }, labels) {
  if (!sector) return null;
  const fromFiling = words(description);
  const evidence = new Set([...words(sicText), ...fromFiling]);
  let best = null;
  let tied = false;
  for (const [industry, labelSector] of Object.entries(labels)) {
    if (labelSector !== sector) continue;
    const shared = [...words(industry)].filter((w) => evidence.has(w));
    if (!shared.length) continue;
    if (shared.length < 2 && !shared.some((w) => fromFiling.has(w))) continue;
    const score = shared.length;
    if (!best || score > best.score) { best = { sector: labelSector, industry, score }; tied = false; }
    else if (score === best.score) tied = true;
  }
  // A TIE IS NOT A SUGGESTION: "beverage" matches both beverage labels, "real
  // estate" all three real-estate ones. Picking the first would dress an
  // arbitrary choice as evidence (PepsiCo -> "Beverages - Alcoholic").
  if (best && !tied) return { sector: best.sector, industry: best.industry };
  return { sector, industry: null };
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

/**
 * The universe's ticker changes the delisting sweep made (#553 COWORK #22), as
 * INFORMATION lines: renames followed by CIK, delistings, and the cases it
 * flagged. Read from the sweep's log (lib/server/secListing.ts
 * LISTING_CHANGES_KEY); only the last `days` are shown, newest first.
 */
export function listingLines(stored, asOf, days = 14) {
  if (!Array.isArray(stored)) return [];
  const cutoff = new Date(Date.parse(`${asOf}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  return stored
    .filter((c) => c && typeof c.at === "string" && typeof c.line === "string" && c.at >= cutoff)
    .map((c) => `${c.at}: ${c.line}`);
}

const padCik = (c) => String(c ?? "").replace(/\D/g, "").padStart(10, "0");

/**
 * POSSIBLE HOLDING-COMPANY SUCCESSIONS (#553 COWORK #44), from A's flag hash
 * (msh:sec:succession-flags:v1, lib/server/secSuccessionFlags.ts). A FLAG
 * ONLY: nothing here links two CIKs. The owner approves a pair and it is added
 * to data/sec/successor-ciks.json by PR; a pair whose predecessor is already
 * on that list (`cited`) is not shown again, even though its flag stays in the
 * hash.
 */
export function successionLines(flags, cited = new Set()) {
  if (!flags || typeof flags !== "object") return [];
  const out = [];
  for (const raw of Object.values(flags)) {
    let f = raw;
    if (typeof f === "string") {
      try { f = JSON.parse(f); } catch { continue; }
    }
    if (!f || !f.symbol || !f.successorCik || !f.predecessorCik) continue;
    if (cited.has(padCik(f.predecessorCik))) continue;
    out.push({
      symbol: String(f.symbol),
      line: `${f.symbol}: possible successor: ${f.successorName ?? "?"} (CIK ${padCik(f.successorCik)}) ← ${f.predecessorName ?? "?"} (CIK ${padCik(f.predecessorCik)}), evidence: 8-K12B ${f.eightK12b ?? "?"}, 25-NSE ${f.nse25 ?? "?"}`,
    });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol)).map((o) => o.line);
}

/** Predecessor CIKs already on the cited successor list, padded. */
export function citedPredecessors(successorFile) {
  const rows = Array.isArray(successorFile?.successors) ? successorFile.successors : [];
  return new Set(rows.filter((r) => r?.predecessorCik != null).map((r) => padCik(r.predecessorCik)));
}

/** The issue body, or null when there is nothing to classify or report (close the issue). */
export function issueBody({ missing, changed }, asOf, universeSize, listing = [], succession = []) {
  if (!missing.length && !changed.length && !listing.length && !succession.length) return null;
  const lines = [
    `Checked ${universeSize} Pickers universe symbols on ${asOf}. The resolver (10-K override, then SIC table) could not fully place the ones below.`,
    "",
    "To approve a row, add it to data/sec/classification-overrides.json in a PR. This helper never edits that file; it rewrites this issue daily and closes it when the list is empty.",
    "",
  ];
  if (missing.length) {
    lines.push(`### No sector or industry (${missing.length})`, "", "| Symbol | Company | SIC | Filing says | Has now | Suggested (a hint: check it) |", "|---|---|---|---|---|---|");
    for (const r of missing.slice(0, MAX_ROWS)) lines.push(`| ${cell(r.symbol, 12)} | ${cell(r.name, 40)} | ${cell(r.sic, 6)} | ${cell(r.description)} | ${cell(fmt(r.have), 50)} | ${cell(fmt(r.suggestion), 60)} |`);
    if (missing.length > MAX_ROWS) lines.push("", `…and ${missing.length - MAX_ROWS} more, listed on the next runs as these are resolved.`);
    lines.push("");
  }
  if (changed.length) {
    lines.push(`### SIC code changed at SEC (${changed.length})`, "", "| Symbol | Company | SIC was → now | SEC wording | Has now | Suggested (a hint: check it) |", "|---|---|---|---|---|---|");
    for (const r of changed) lines.push(`| ${cell(r.symbol, 12)} | ${cell(r.name, 40)} | ${cell(r.was, 6)} → ${cell(r.now, 6)} | ${cell(r.secDescription, 60)} | ${cell(fmt(r.have), 50)} | ${cell(fmt(r.suggestion), 60)} |`);
    lines.push("");
  }
  if (listing.length) {
    lines.push(`### Ticker changes (information; no action needed) (${listing.length})`, "", "Made automatically by the daily delisting sweep: a rename keeps the company (same SEC CIK) under its new ticker; a delisting leaves the universe. Lines marked \"check by hand\" were not decided automatically.", "");
    for (const l of listing.slice(0, MAX_ROWS)) lines.push(`- ${cell(l, 200)}`);
    lines.push("");
  }
  if (succession.length) {
    lines.push(`### Possible holding-company successions (flag only; never linked automatically) (${succession.length})`, "", "An 8-K12B by a new registrant and a 25-NSE for a tracked one with the same name. To link a pair, add it to data/sec/successor-ciks.json in a PR after checking both filings; this helper never links them.", "");
    for (const l of succession.slice(0, MAX_ROWS)) lines.push(`- ${cell(l, 240)}`);
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
