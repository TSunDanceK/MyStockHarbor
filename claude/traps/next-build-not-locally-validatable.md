# `next build` cannot be validated locally in this repo

Without `UPSTASH_REDIS_REST_URL` / `_TOKEN`, `npx next build` **fails** — the
ISR'd screener pages exceed Next's 60s per-page static-generation budget against
a cold cache and the export aborts. Verified 2026-08-20 that unmodified `main`
(`76014d03`) fails identically to a working tree with changes: same pages, same
timeout, exit 1.

So a local build failure here is **not** evidence your change broke something,
and a local build is not available as a check. Use the Vercel preview, which has
credentials. This is the practical face of Rule 1 in
`claude/picker-pages-isr-2026-08-20.md`: *a build without Redis credentials
proves nothing.*

**And the check you cannot run at all:** `*.vercel.app` preview hosts and
`www.mystockharbor.com` both return `403 CONNECT tunnel failed` from the
sandbox proxy. A Claude session **cannot fetch its own preview or the live
site**, so "confirm the deployed page renders rows" is owner-side. Worth
stating plainly on a page whose whole bug was that it compiled fine and
rendered a falsehood: a green build is not a rendered page.

**Also corrected 2026-08-20:** the root `CLAUDE.md` allowlist lesson was *half*
wrong, which is worse than wholly wrong — the npm registry is now reachable
(`npm ping` and `npm ci` both succeed through the agent proxy, which is what
makes local `tsc`/`eslint` possible), while the preview and production hosts
are not. It was split into its three separate facts rather than deleted, since
deleting it would have created the opposite wrong belief. Re-test reachability
rather than trusting any such list; it is exactly the kind of stale note this
file exists to catch.
