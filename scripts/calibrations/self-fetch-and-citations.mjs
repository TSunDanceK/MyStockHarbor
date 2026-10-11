// The last server-side self-fetch, and the dangling-citation ratchet.
export const TITLE = "In-process payload read + doc-citation existence";

const PAGE = "app/pickers/page.tsx";
const CITE = "scripts/check-doc-citations.mjs";
const SF = "scripts/check-no-self-fetch.mjs";
const CACHE = "scripts/check-oversized-cache.mjs";

export const MUTATIONS = [
  {
    id: "S1",
    description: "the self-fetch comes back",
    file: PAGE,
    find: "    return (await getPickersData(SITE_ORIGIN)) as unknown as PickersPayload;",
    replace:
      '    const res = await fetch(`${SITE_ORIGIN}/api/pickers`, { next: { revalidate: 300 } });\n    return (await res.json()) as PickersPayload;',
    harnesses: [SF, CACHE],
    expect: 4,
  },
  {
    id: "S2",
    description: "self-fetch patterns broken (negative check would pass blind)",
    file: SF,
    find: "  /fetch\\(\\s*`\\$\\{base\\}\\/api\\//,",
    replace: "  /fetch\\(\\s*`\\$\\{NEVERMATCHES\\}\\/api\\//,",
    harnesses: [SF],
    // The positive control exists precisely so a broken pattern cannot read as
    // "no offenders". Without it this mutation would fail 0.
    expect: 1,
  },
  {
    id: "S3",
    description: "a NEW dangling citation is added to code",
    file: "lib/server/historyCache.ts",
    find: "import { Redis } from \"@upstash/redis\";",
    replace: "// See claude/this-doc-does-not-exist-2026-08-24.md\nimport { Redis } from \"@upstash/redis\";",
    harnesses: [CITE],
    expect: 1,
  },
  {
    id: "S4",
    description: "allowlist entry kept for a doc that now exists",
    file: CITE,
    find: '  "claude/CLAUDE.md",',
    replace: '  "claude/RENDERING_POLICY.md",\n  "claude/CLAUDE.md",',
    harnesses: [CITE],
    // STALE ONLY, not orphaned: RENDERING_POLICY.md exists AND is still cited
    // (app/components/NewsScoreGauge.tsx). I predicted 2 and it is 1 -- the two
    // conditions are genuinely independent, which is why S5 exercises the other
    // one separately rather than assuming this mutation covered both.
    expect: 1,
  },
  {
    id: "S5",
    description: "allowlist entry for a doc nothing cites (orphan)",
    file: CITE,
    // Exists in the repo AND is cited by nothing, so only the orphan check can
    // catch it. Without S5 that assertion would never have been exercised.
    find: '  "claude/CLAUDE.md",',
    replace: '  "claude/NEXT-SESSION.md",\n  "claude/CLAUDE.md",',
    harnesses: [CITE],
    expect: 2,
  },
  {
    id: "S6",
    description: "the citation scan goes back to tracked files only",
    file: CITE,
    find: '["ls-files", "--cached", "--others", "--exclude-standard"]',
    replace: '["ls-files"]',
    // NOT a failure count: this mutation is invisible on a clean tree, because
    // every file is already tracked. It is recorded so the reason for the flags
    // survives -- an UNCOMMITTED new file carrying a dangling citation would
    // pass under `ls-files` alone, which is exactly how the S3 fixture sat
    // through a green run. The hole only opens on a dirty tree, so no harness
    // can catch it here; the note is the artefact.
    harnesses: [CITE],
    expect: 0,
  },
  {
    id: "S7",
    description: "calibration fixtures no longer skipped",
    file: CITE,
    find: 'rel === SELF || rel.startsWith("scripts/calibrations/")',
    replace: "rel === SELF",
    harnesses: [CITE],
    // Loud: a mutation spec's deliberately-fake path reads as a real dangling
    // citation. This is the half that fails.
    expect: 1,
  },
  {
    id: "S8",
    description: "the harness scans ITSELF (allowlist counted as citations)",
    file: CITE,
    find: 'rel === SELF || rel.startsWith("scripts/calibrations/")',
    replace: 'rel.startsWith("scripts/calibrations/")',
    harnesses: [CITE],
    // SILENT, and that is the finding. Scanning itself breaks no assertion --
    // it CORRUPTS THE REPORT. Every allowlisted doc then reads as "cited from
    // code", turning 18-of-23 into 23-of-23 and inflating every per-doc weight
    // by one, and that weighting is exactly what someone would use to decide
    // which doc to mirror first. A measurement can be wrong with nothing going
    // red; recorded here because no check can catch it.
    expect: 0,
  },
];
