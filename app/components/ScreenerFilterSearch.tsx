"use client";

import { useMemo, useRef, useState } from "react";
import { usePickerFilter } from "@/app/components/PickerFilterContext";
import {
  ALL_FIELDS,
  fieldLabel,
  type Predicate,
  type ScreenerFieldDef,
} from "@/lib/screenerFields";

/**
 * "Add a filter" -- one input that reaches every filterable field.
 *
 * The problem this solves: there are 33 filterable fields and one of them
 * (industry) has ~150 values. Rendering any of that as a list would bury the
 * condition checkboxes people already use. So nothing is rendered until it's
 * searched for, and the panel grows by one row instead of a hundred and fifty.
 *
 * The important detail is that it matches TWO different things at once:
 *
 *   * field names   -- "pe" finds the PE Ratio field, which adds a min/max row
 *   * category VALUES -- "semi" finds Semiconductors, a value of the industry
 *     field, which adds it directly as a filter
 *
 * That dual match is what makes "cheap semiconductor stocks" reachable from a
 * single box. "Semiconductors" isn't a field, it's a value; "PE Ratio" is a
 * field, not a value. Matching only one of the two would need two controls.
 *
 * Typing a category field's own name ("sector", "industry") lists its values,
 * so the box works for browsing as well as for people who already know the
 * name they want.
 */

type Suggestion =
  | { type: "field"; field: ScreenerFieldDef }
  | { type: "value"; field: ScreenerFieldDef; value: string };

const MAX_SUGGESTIONS = 14;
// Cap on how many values one category contributes to an unfiltered browse, so
// typing "industry" doesn't dump 150 rows into the panel.
const MAX_VALUES_PER_CATEGORY = 8;

function suggestionKey(s: Suggestion) {
  return s.type === "field" ? `f:${s.field.key}` : `v:${s.field.key}:${s.value}`;
}

function matches(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle);
}

function fieldMatches(field: ScreenerFieldDef, needle: string) {
  if (matches(field.label, needle)) return true;
  if (matches(field.group, needle)) return true;
  return (field.aliases ?? []).some((alias) => matches(alias, needle));
}

export default function ScreenerFilterSearch({
  categoryValues,
}: {
  // Values actually present in the current universe, keyed by category field
  // ("sector" -> [...], "industry" -> [...]). Derived from the entries in
  // PickerResultPage rather than hardcoded, so a value with nothing behind it
  // is never offered.
  categoryValues: Record<string, string[]>;
}) {
  const { predicates, setPredicate, removePredicate, toggleFilter } = usePickerFilter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const needle = query.trim().toLowerCase();

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!needle) return [];
    const out: Suggestion[] = [];

    // Category values first: someone typing "semi" wants Semiconductors, not
    // the Industry field. Ranking values above fields is what makes the common
    // case a single keystroke sequence.
    for (const field of ALL_FIELDS) {
      if (field.kind !== "category") continue;
      const values = categoryValues[field.key] ?? [];
      const nameHit = fieldMatches(field, needle);
      const hits = values.filter((v) => matches(v, needle));
      // Typing the field's own name lists its values; typing a value matches
      // just that value.
      const chosen = hits.length ? hits : nameHit ? values : [];
      for (const value of chosen.slice(0, MAX_VALUES_PER_CATEGORY)) {
        out.push({ type: "value", field, value });
      }
    }

    for (const field of ALL_FIELDS) {
      if (field.kind === "category") continue;
      if (fieldMatches(field, needle)) out.push({ type: "field", field });
    }

    return out.slice(0, MAX_SUGGESTIONS);
  }, [needle, categoryValues]);

  const numberPredicates = useMemo(
    () => predicates.filter((p): p is Extract<Predicate, { kind: "number" }> => p.kind === "number"),
    [predicates]
  );

  function applySuggestion(s: Suggestion) {
    if (s.type === "value") {
      const existing = predicates.find((p) => p.kind === "category" && p.field === s.field.key);
      const current = existing && existing.kind === "category" ? existing.values : [];
      if (current.includes(s.value)) {
        // Already applied -- selecting it again removes it, so the box is a
        // toggle rather than a way to silently do nothing.
        const next = current.filter((v) => v !== s.value);
        if (next.length) setPredicate({ kind: "category", field: s.field.key, values: next });
        else removePredicate("category", s.field.key);
      } else {
        setPredicate({ kind: "category", field: s.field.key, values: [...current, s.value] });
      }
    } else if (s.field.kind === "flag") {
      toggleFilter(s.field.key as Parameters<typeof toggleFilter>[0]);
    } else {
      // Numeric: add the field with no bounds yet and let the visitor type one
      // into the row that appears below. An unbounded numeric predicate matches
      // any stock that HAS the value, which is a real (if blunt) filter -- it
      // excludes stocks with no earnings from a PE screen, for instance.
      const already = predicates.some((p) => p.kind === "number" && p.field === s.field.key);
      if (!already) setPredicate({ kind: "number", field: s.field.key });
    }
    setQuery("");
    inputRef.current?.focus();
  }

  function updateBound(field: string, bound: "min" | "max", raw: string) {
    const existing = predicates.find((p) => p.kind === "number" && p.field === field);
    const current = existing && existing.kind === "number" ? existing : { kind: "number" as const, field };
    const parsed = raw.trim() === "" ? undefined : Number(raw);
    const value = parsed != null && Number.isFinite(parsed) ? parsed : undefined;
    setPredicate({ ...current, [bound]: value });
  }

  function isValueApplied(fieldKey: string, value: string) {
    const p = predicates.find((x) => x.kind === "category" && x.field === fieldKey);
    return p && p.kind === "category" ? p.values.includes(value) : false;
  }

  function isFieldApplied(field: ScreenerFieldDef) {
    if (field.kind === "flag") return predicates.some((p) => p.kind === "flag" && p.field === field.key);
    return predicates.some((p) => p.kind === "number" && p.field === field.key);
  }

  return (
    <div className="screenerSearchWrap">
      <input
        ref={inputRef}
        type="search"
        className="screenerFieldSearch"
        placeholder="Add a filter…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Blur is delayed so a tap on a suggestion registers before the list
        // unmounts -- without this the panel closes on mousedown and the click
        // never lands.
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        aria-label="Search filters"
        autoComplete="off"
      />

      {open && needle ? (
        <div className="screenerSearchResults" role="listbox">
          {suggestions.length ? (
            suggestions.map((s) => {
              const applied =
                s.type === "value" ? isValueApplied(s.field.key, s.value) : isFieldApplied(s.field);
              return (
                <button
                  key={suggestionKey(s)}
                  type="button"
                  role="option"
                  aria-selected={applied}
                  className={applied ? "screenerSearchHit applied" : "screenerSearchHit"}
                  onClick={() => applySuggestion(s)}
                >
                  <span className="screenerSearchHitLabel">
                    {s.type === "value" ? s.value : s.field.label}
                  </span>
                  <span className="screenerSearchHitGroup">
                    {s.type === "value" ? s.field.label : s.field.group}
                  </span>
                  {applied ? (
                    <span className="screenerSearchHitTick" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })
          ) : (
            <div className="screenerSearchEmpty">No filters match “{query.trim()}”.</div>
          )}
        </div>
      ) : null}

      {/* Min/max editors for every numeric filter currently applied. These live
          here rather than in the chip bar because they need typing room, and a
          chip is a one-tap remove control. The chip for the same predicate
          still shows above the results and still removes it. */}
      {numberPredicates.length ? (
        <div className="screenerNumRows">
          {numberPredicates.map((p) => (
            <div key={p.field} className="screenerNumRow">
              <span className="screenerNumLabel">{fieldLabel(p.field)}</span>
              <input
                type="number"
                className="screenerNumInput"
                placeholder="min"
                value={p.min ?? ""}
                onChange={(e) => updateBound(p.field, "min", e.target.value)}
                aria-label={`${fieldLabel(p.field)} minimum`}
              />
              <input
                type="number"
                className="screenerNumInput"
                placeholder="max"
                value={p.max ?? ""}
                onChange={(e) => updateBound(p.field, "max", e.target.value)}
                aria-label={`${fieldLabel(p.field)} maximum`}
              />
              <button
                type="button"
                className="screenerNumRemove"
                onClick={() => removePredicate("number", p.field)}
                aria-label={`Remove ${fieldLabel(p.field)} filter`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <style>{`
        .screenerSearchWrap { position: relative; padding: 0 4px 12px; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .screenerFieldSearch {
          width: 100%; box-sizing: border-box;
          padding: 9px 11px; border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.04);
          color: #f1f5f9; font-family: inherit; font-size: 13px; font-weight: 700;
        }
        .screenerFieldSearch::placeholder { color: rgba(148,163,184,0.7); font-weight: 600; }
        .screenerFieldSearch:focus { outline: none; border-color: rgba(96,165,250,0.6); background: rgba(255,255,255,0.06); }

        .screenerSearchResults {
          position: absolute; left: 4px; right: 4px; top: 100%; z-index: 20;
          margin-top: 4px; padding: 5px;
          max-height: 300px; overflow-y: auto;
          border-radius: 12px; border: 1px solid rgba(255,255,255,0.14);
          background: #0b1220; box-shadow: 0 16px 38px rgba(0,0,0,0.5);
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.18) transparent;
        }
        .screenerSearchHit {
          display: flex; align-items: center; gap: 8px; width: 100%;
          padding: 8px 9px; border: none; border-radius: 8px;
          background: transparent; color: #e2e8f0;
          font-family: inherit; font-size: 12.5px; font-weight: 700;
          text-align: left; cursor: pointer;
        }
        .screenerSearchHit:hover { background: #141b2b; color: #f8fafc; }
        .screenerSearchHit.applied { color: #bbf7d0; }
        .screenerSearchHitLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .screenerSearchHitGroup {
          margin-left: auto; flex: 0 0 auto;
          font-size: 10px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
          color: rgba(148,163,184,0.6); white-space: nowrap;
        }
        .screenerSearchHitTick { flex: 0 0 auto; font-size: 11px; color: #4ade80; }
        .screenerSearchEmpty { padding: 10px; font-size: 12px; color: rgba(148,163,184,0.8); }

        .screenerNumRows { display: grid; gap: 6px; margin-top: 10px; }
        .screenerNumRow {
          display: grid; grid-template-columns: 1fr 62px 62px 24px; align-items: center; gap: 6px;
        }
        .screenerNumLabel {
          min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-size: 12px; font-weight: 800; color: rgba(226,232,240,0.85);
        }
        .screenerNumInput {
          width: 100%; box-sizing: border-box;
          padding: 6px 7px; border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.04);
          color: #f1f5f9; font-family: inherit; font-size: 12px; font-weight: 700;
        }
        .screenerNumInput:focus { outline: none; border-color: rgba(96,165,250,0.6); }
        .screenerNumRemove {
          width: 24px; height: 24px; padding: 0;
          border-radius: 7px; border: 1px solid rgba(239,68,68,0.3);
          background: rgba(239,68,68,0.08); color: #fca5a5;
          font-size: 10px; font-weight: 900; cursor: pointer;
        }
      `}</style>
    </div>
  );
}
