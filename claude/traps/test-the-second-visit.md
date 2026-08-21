# Test the SECOND visit, not the first

Two changes in one day would have shipped looking like fixes while doing
nothing for the case they were built for. Both passed every first-visit test.

- **#294** — the "Resume" chip appeared exactly once and never again. Visit 1
  overwrote the remembered symbol with what merely rendered, so visit 2 had
  nothing to resume.
- **#300** — the cookie was never written for anyone who already had a
  remembered symbol, so every existing user got a server-rendered `SPY` and a
  client-rendered `CAG`, **forever**, and the PR looked like it removed a
  discard it had left entirely in place.

Neither is visible in one load. Both are obvious in two.

**The rule:** any change touching persisted state — localStorage, a cookie, a
cache, a remembered preference — is not tested until a SECOND read has
happened, and where the state is per-origin or per-session, in a genuinely
fresh context.

A corollary that cost real time on #300: **a preview deployment is a different
hostname, so `localStorage` there is empty.** Testing a migration path on a
preview makes you a brand-new visitor by construction — the one case the
migration does not cover. That test cannot fail, which is not the same as
passing.
