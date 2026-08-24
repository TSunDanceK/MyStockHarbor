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
];
