# Rotating EARNINGS_BACKFILL_KEY

Prepared 2026-09-21, unexecuted. The owner's condition is "only once the whole
job is done"; that condition is **not recorded anywhere in this repo**, so
whether it has been met is Sundance's call, not something a session can check.
This document exists so that when he says go, the rotation is a ten-minute job
rather than an investigation.

---

## The finding that shrinks this job: no repo edits are needed

Every reference to the key in this repository is a **placeholder** —
`$EARNINGS_BACKFILL_KEY`, `<EARNINGS_BACKFILL_KEY>`, or `key=...`. Checked
across `claude/`, `app/` and `lib/` on 2026-09-21: no file contains a literal
key value.

So the six `claude/` docs that mention the key (`HANDOFF-logos-2026-09-17`,
`BRIEF-logo-harvest-2026-09-14`, `earnings-season-measurement-2026-09-02`,
`pipeline-probe-verdicts-2026-09-01`, `universe-consolidation-remaining-work`,
`app/api/debug/static-profile/README.md`) **do not change**. Their example
invocations are still correct after rotation, because they never named the
secret in the first place.

**The rotation is a Vercel environment change plus a redeploy. Nothing else.**

---

## The complete list of what breaks until the new key is in hand

18 surfaces, all through `checkBackfillKey` in `lib/server/backfillAuth.ts`.
Derived by scanning, not typed from memory — re-derive with
`grep -rln "guardDebugRequest\|checkBackfillKey" app/ lib/`.

**14 debug routes**, each via `guardDebugRequest`, all fail CLOSED:

```
/api/debug/earnings/[symbol]        /api/debug/pickers-size
/api/debug/earnings-calendar        /api/debug/static-profile
/api/debug/earnings-calendar-limit  /api/debug/symbol-changes
/api/debug/earnings-concentration   /api/debug/symbol-search
/api/debug/fmp-endpoints            /api/debug/universe-size
/api/debug/fmp-usage                /api/debug/index-changes
/api/debug/ipo-calendar             /api/debug/picker-structure
```

**1 write route**, fails closed:

```
POST /api/earnings-calendar/backfill-date   (the Backfill button on /earnings-calendar)
```

**3 force paths**, which **fail SOFT** — this is the one that will not announce
itself. `handlePickersRequest` in `lib/server/pickersBuilder.ts:5123` treats a
bad key as "no force" and serves the normal cached response:

```
/api/plays?force=1&key=…
/api/bull-flags?force=1&key=…
/api/descending-triangles?force=1&key=…
```

A stale key here returns **200 with cached data**, not a 401. Anyone forcing a
rebuild with the old key will see a successful-looking response and no rebuild.

Not affected: `CACHE_HEALTH_KEY` and `CRON_SECRET` are separate credentials
with separate lockout namespaces, deliberately (see `backfillAuth.ts`).

---

## Steps

1. Generate the new value. Nothing in the repo constrains its shape;
   `openssl rand -hex 32` is fine.
2. Set `EARNINGS_BACKFILL_KEY` in Vercel → Project → Settings → Environment
   Variables, for **every environment the owner uses** (production at minimum;
   preview too if debug routes are ever opened on a preview).
3. **Redeploy.** Vercel injects environment variables into a deployment when it
   is built — changing the value does not reach deployments that already exist.
   Until a redeploy, the old key keeps working and the new one does not.
4. Verify, using the checklist below.
5. Replace the value in the owner's own store (password manager, phone
   bookmarks). The repo holds nothing to update.

---

## Before verifying, read this or lose ten minutes

`checkBackfillLockout` allows **3 failed attempts per IP per 10 minutes**
(`MAX_ATTEMPTS`, `LOCKOUT_SECONDS` in `backfillAuth.ts`). A rotation is
precisely the situation that burns them: one paste of the old key, one typo,
one request that raced the redeploy, and the fourth attempt — the correct one —
returns 429.

- A **successful** request calls `clearBackfillFailures` and resets the counter,
  so verifying the right key first costs nothing.
- If locked out, the 429 body and the `retry-after` header both carry the wait.
- The counter is at `msh:earnings-backfill-fail:v2:<ip>` and can be cleared
  directly from Upstash if the wait is not acceptable.

---

## Verification checklist

One from each of the three classes is enough to prove the swap; all three are
needed, because the failure modes differ.

- [ ] **A debug route, new key** — e.g.
      `/api/debug/fmp-usage?key=<NEW>` → 200 with a body.
- [ ] **The same route, old key** → 401 `{"ok":false,"error":"Unauthorized"}`.
      If this returns 200, the redeploy has not landed yet. *(Costs one of the
      three attempts — do it last within its 10-minute window, or accept the
      lockout.)*
- [ ] **The backfill button** on `/earnings-calendar` with the new key → the
      request succeeds rather than reporting unauthorized.
- [ ] **A force path** — `/api/plays?force=1&key=<NEW>`. Since a bad key here
      returns a normal 200, "it responded" proves nothing: confirm a rebuild
      actually happened (response timing, or the build's own logging), not just
      a 200.

---

## If it goes wrong

Set the old value back in Vercel and redeploy. There is no migration and no
stored state keyed on the secret — `checkBackfillKey` is a string comparison
against `process.env` — so a rollback is complete the moment the redeploy
finishes.
