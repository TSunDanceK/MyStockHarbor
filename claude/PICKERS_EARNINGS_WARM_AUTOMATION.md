# Pickers & Earnings daily warm-up automation (mirror)

This is a GitHub mirror of the `claude/PICKERS_EARNINGS_WARM_AUTOMATION.md` doc
kept in the Claude Project "My Stock Harbor Website".

This automation runs as a **GitHub Actions scheduled workflow** (not a Claude
scheduled task) — see `.github/workflows/pickers-warm.yml` in this repo,
merged via PR #37. Runs daily at `cron: "3 5 * * *"` UTC, hitting
`/api/jobs/warm-picker-universe` then `/api/jobs/warm-earnings` twice (120s
apart). GitHub Actions was chosen over a Claude scheduled task because Claude's
cloud sandbox network policy blocks `mystockharbor.com` itself, and because
relying on the user's Chrome being open would defeat the point of unattended
automation. See the Claude Project copy for full detail and history.

## Corrected 2026-09-02 — the endpoints are NOT public

This file used to say: *"Both endpoints are public, unauthenticated, and
self-rate-limiting."* **That was wrong, and it was wrong in the direction that
kept a broken job looking healthy.**

* `/api/jobs/warm-earnings` gates on `Bearer ${process.env.CRON_SECRET}` and
  returns **401** without it.
* `/api/jobs/warm-picker-universe` returns **200** without it — but the secret
  is what authorises the *history force* (`isCronAuthorized` in
  `pickersBuilder.ts`). Unauthenticated it runs as an ordinary miss-only warm,
  which against a 50h history TTL refreshes nothing. It records
  `refreshMode: "miss-only"` and logs *"Check CRON_SECRET is set"* when that
  happens.

Vercel's own cron sends the header automatically, which is why the 07:15
`vercel.json` run has always worked and these three calls had not. From run
`33614228672` on 2026-09-02:

```
warm-picker-universe: HTTP 200      <- in 2.0s, i.e. not forced
warm-earnings pass 1: HTTP 401
warm-earnings pass 2: HTTP 401
job conclusion: SUCCESS
```

**Consequence:** warm-earnings has been doing `EARNINGS_BATCH_SIZE` symbols
once a day (the Vercel cron) rather than three times, for as long as
`CRON_SECRET` has been set in the Vercel project. Any figure derived from
observed earnings coverage — including the 80/327 recorded on 2026-09-02 —
describes a job running at a third of its intended rate.

The workflow now sends `Authorization: Bearer ${{ secrets.CRON_SECRET }}` on
all three calls from a single `call` helper, and **fails the step on a non-200**
(`curl -sS -o /dev/null -w "%{http_code}"` exits 0 on a 401, which is how three
failing calls read as a green tick for weeks).

**It stays dead until a human adds `CRON_SECRET` to the repository's Actions
secrets** — Settings → Secrets and variables → Actions — matching the value in
the Vercel project. The workflow now fails loudly with that instruction rather
than 401ing quietly.

`scripts/check-cron-auth.mjs` asserts the rule from here on: every
CRON_SECRET-gated job route reached from a workflow is reached with the header,
the gated list being derived from the routes rather than typed.

## The `/pickers` "Fetch Earnings" button is a different problem

`app/pickers/PickersClient.tsx` calls the same route **from the browser**, so it
has been failing on 401 for every visitor who clicks it (it renders "Earnings
warm-up failed. Try again in a moment."). It must **not** get the same fix:
`CRON_SECRET` in client code ships the secret to every visitor. It is
architecturally dead, not misconfigured — see the PR for the recommendation.
