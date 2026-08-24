// The 2 MB Data Cache guard. `next: { revalidate }` on a body over the limit is
// silently inert, so this guard is the only thing that makes the class visible.
export const TITLE = "Oversized cached fetch — the failure that looks like success";

const USAGE = "lib/server/fmpUsage.ts";
const PAGE = "app/pickers/page.tsx";
const H = "scripts/check-oversized-cache.mjs";

export const MUTATIONS = [
  {
    id: "O1",
    description: "the guard is never called",
    file: USAGE,
    find: "    warnIfTooBigToCache(url, init, body.byteLength);\n",
    replace: "",
    harnesses: [H],
    expect: 1,
  },
  {
    id: "O2",
    description: "limit raised past the real one (guard never fires)",
    file: USAGE,
    find: "const NEXT_DATA_CACHE_MAX_BYTES = 2 * 1024 * 1024;",
    replace: "const NEXT_DATA_CACHE_MAX_BYTES = 64 * 1024 * 1024;",
    harnesses: [H],
    // The counts here CASCADE: the assertions share one `seen` array, so once
    // the guard stops firing every subsequent count is off by the same root
    // cause. Recorded as measured rather than as predicted -- a cascading count
    // is still a stable one, and guessing it produced three false drifts on the
    // first run.
    expect: 10,
  },
  {
    id: "O3",
    description: "fires regardless of whether a revalidate was asked for",
    file: USAGE,
    find: "  if (!wantsCache || bytes <= NEXT_DATA_CACHE_MAX_BYTES) return;",
    replace: "  if (bytes <= NEXT_DATA_CACHE_MAX_BYTES) return;",
    harnesses: [H],
    expect: 5,
  },
  {
    id: "O4",
    description: "dedupe removed (a hot path floods the log)",
    file: USAGE,
    find: "  if (oversizedCacheWarned.has(endpoint)) return;\n  oversizedCacheWarned.add(endpoint);\n",
    replace: "",
    harnesses: [H],
    expect: 3,
  },
  {
    id: "O5",
    description: "boundary made inclusive (exactly 2 MB warns)",
    file: USAGE,
    find: "bytes <= NEXT_DATA_CACHE_MAX_BYTES) return;",
    replace: "bytes < NEXT_DATA_CACHE_MAX_BYTES) return;",
    harnesses: [H],
    expect: 2,
  },
  {
    id: "O6",
    description: "the pickers comment goes back to claiming the dedupe",
    file: PAGE,
    find: "// THE `revalidate` BELOW IS INERT, AND THIS COMMENT USED TO CLAIM OTHERWISE.",
    replace: "// The dedupe works fine.",
    harnesses: [H],
    expect: 1,
  },
];
