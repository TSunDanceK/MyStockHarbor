// #363's calibration, as a re-runnable spec.
//
// The stripper is read by every other harness, so a regression here is a
// regression everywhere at once -- and in the quiet direction, because a strip
// that eats a region makes NEGATIVE assertions pass.
export const TITLE = "#363 — the guarded, parser-based comment stripper";

const LIB = "scripts/lib/source-code.mjs";
const STRIPPER = "scripts/check-comment-stripper.mjs";
const INERT = "scripts/check-inert-terms.mjs";

export const MUTATIONS = [
  {
    id: "C1",
    description: "a harness rolls its own regex again",
    file: INERT,
    find: "const code = stripComments(raw, { file: SRC });",
    replace:
      'const code = raw.replace(/\\/\\*[\\s\\S]*?\\*\\//g, "").split("\\n").filter((l) => !l.trim().startsWith("//")).join("\\n");',
    harnesses: [STRIPPER],
    expect: 1,
  },
  {
    id: "C2",
    description: "stripComments becomes a no-op",
    file: LIB,
    find: "  const sorted = [...ranges].sort((a, b) => a.pos - b.pos);",
    replace: "  ranges.length = 0;\n  const sorted = [...ranges].sort((a, b) => a.pos - b.pos);",
    harnesses: [STRIPPER],
    expect: 8,
  },
  {
    id: "C3",
    description: "code-point indexing bug reintroduced",
    file: LIB,
    edits: [
      {
        find: `  const sorted = [...ranges].sort((a, b) => a.pos - b.pos);
  let out = "";
  let cursor = 0;
  for (const r of sorted) {
    if (r.pos < cursor) continue; // overlapping/duplicate range, already covered
    out += text.slice(cursor, r.pos);
    out += text.slice(r.pos, r.end).replace(/[^\\n]/g, " ");
    cursor = r.end;
  }
  out += text.slice(cursor);`,
        replace: `  const chars = [...text];
  for (const r of ranges) {
    for (let i = r.pos; i < r.end && i < chars.length; i++) if (chars[i] !== "\\n") chars[i] = " ";
  }
  const out = chars.join("");`,
      },
    ],
    // Not the stripper's own harness: this one only bites files containing a
    // non-BMP character, and the fixtures do not. It shows up as four DOWNSTREAM
    // harnesses failing, which is the honest picture of its blast radius.
    harnesses: [
      "scripts/check-cache-health-page.mjs",
      "scripts/check-fmp-metered.mjs",
      "scripts/check-internal-links.mjs",
      "scripts/check-signal-counts-single-source.mjs",
    ],
    expect: "CRASH (check-cache-health-page.mjs, check-fmp-metered.mjs, check-internal-links.mjs, check-signal-counts-single-source.mjs)",
  },
  {
    id: "C4",
    description: "assertStripKeptTheCode becomes a no-op",
    file: LIB,
    find: "  const markers = outsideCommentMarkers(raw, file);\n  const lost = [];",
    replace:
      "  const markers = outsideCommentMarkers(raw, file);\n  const lost = [];\n  if (true) return { markers: markers.size, keptFraction: 1 };",
    harnesses: [STRIPPER],
    expect: 5,
  },
  {
    id: "C5",
    description: "trailing comment ranges dropped",
    file: LIB,
    find: "      for (const r of ts.getTrailingCommentRanges(text, node.getEnd()) ?? []) ranges.push(r);\n",
    replace: "",
    harnesses: [STRIPPER],
    expect: 1,
  },
];
