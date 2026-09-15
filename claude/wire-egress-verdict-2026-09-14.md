# GlobeNewswire is not blocked. The hang is ours.

2026-09-14. Supersedes the "contributes nothing, and cannot" half of
`claude/news-flip-done-2026-09-14.md` §4, which is now banner-corrected in place.

---

## 1. The question, and why only Vercel could answer it

Stock-page renders showed a 5,002ms leg attributable to GlobeNewswire — 5,002
being the `ADAPTER_TIMEOUT_MS` abort, not a measured duration. The per-feed
`endPoll()` sits in a `finally`, so the *absence* of its log line could only mean
one thing: the fetch never settled.

Two explanations fit that equally well, and they lead to opposite decisions:

| If it is… | Then the wire leg on stock pages is… |
|---|---|
| Vercel's egress being refused or silently dropped by the host | dead until something outside our control changes |
| something about *our* request | recoverable, and per-symbol wire attribution comes back |

Neither the agent sandbox nor a GitHub runner can distinguish them — the sandbox
is refused `globenewswire.com` outright, and a runner reaches it in 12–330ms,
which is exactly what makes the Vercel-specific question live. The probe had to
run where the problem is.

## 2. Round one: it answers

`/api/debug/wire-egress`, three rounds, 20s timeout, from a Vercel function:

| host | verdict | ms per round | statuses |
|---|---|---|---|
| globenewswire | `answers` | 157 / 38 / 28 | 200, 200, 200 |
| gnews-control | `answers` | — | 200 ×3 |

**GlobeNewswire is not blocked from Vercel.** Not refused, not silently dropped,
not slow. 28ms on a warm socket. The 5,002ms hang is ours.

`§B` of the brief (stop polling it per-symbol because the host is unreachable)
does not apply. `§A` is not the fix either. Per-symbol wire attribution is
**recoverable**.

## 3. What round one could not say

The probe's fetch differed from the render's fetch in **two** ways at once:

|  | probe (round one) | the render (`wireProvider.ts:214`) |
|---|---|---|
| cache mode | `cache: "no-store"` | `next: { revalidate: 3600 }` |
| User-Agent | explicit MSH string | none (Node's default) |

Two variables changed, one result. That is unattributable, and treating it as
attributable is exactly the error §4 of the other doc already had to be
corrected for. Hence a 2×2.

## 4. The 2×2 — RESULT: it is the User-Agent

Run on `dpl_9gPECxiytLhsXsvonaJNs5nPahPd` (0d85d5d), 09:33 UTC. Round 1:

| cell | cache | UA | ms | status | bytes |
|---|---|---|---|---|---|
| control | `no-store` | yes | 365 | 200 | 123,354 |
| **A** | `no-store` | no | **20,001** | aborted | 0 |
| **C** | `revalidate:3600` | no | **20,003** | aborted | 0 |
| **B** | `no-store` | yes | 207 | 200 | 33,016 |
| **D** | `revalidate:3600` | yes | **183** | 200 | 33,031 |

The decision rule, fixed before the numbers arrived, was: *C hangs + A hangs ⇒
the User-Agent*. Both hung. **It is the User-Agent.**

D closes it from the other side: `revalidate:3600` is the render's own cache
mode, and with a UA attached it answers in 183ms. **The Data Cache was never
implicated.** Round 2 reproduced everything including D at 1ms — the cache hit
predicted in advance, and the reason reading round 1 only was the right call.

### The mechanism: a tarpit, not a block

`cause` was **empty on every abort**. No `ECONNREFUSED`, no `ENOTFOUND`, no
`UND_ERR_CONNECT_TIMEOUT`. The connection opens and is simply never answered.

That is also the explanation for the missing log line that made this so hard to
attribute: the promise never settles, so the per-feed `finally` never runs,
`endPoll()` never fires, nothing is caught and nothing is thrown. **The failure
produced no output of any kind.** A page that renders, tests that pass, and one
leg of the feed quietly contributing nothing.

## 5. The fix

One header on the wire fetches in `pollAll()`, using the exact string measured in
cell D. `lib/server/news/userAgent.ts` owns it.

### The four constraints, and what each became in code

**1. An unset variable must not silently reintroduce the hang.** The wire UA
reads **no environment variable at all** — it is an in-tree constant. An env
read is exactly the mechanism that can go missing: blank in one environment and
the request goes out bare, tarpits for the full adapter budget, logs nothing,
throws nothing, and the two-day bug is back in the one place nobody would look
because "the fix is already shipped". Asserted behaviourally, not textually:
`newsUserAgent()` is called with the variables unset, empty **and whitespace**
(the state a cleared dashboard field leaves behind), and must return non-empty
each time. Structurally too — `newsUserAgent()`'s body must contain no
`process.env`, so the guarantee does not rest on today's implementation.

**2. `SEC_USER_AGENT` was the wrong home, and the split is deliberate.**

| | mechanism | why |
|---|---|---|
| wires | constant only, not overridable | emptiness is a silent outage |
| sec | env var, constant as fallback | the address is a published contact the operator must change without a deploy |

`secUserAgent()` now *derives* its fallback from the shared constant instead of
carrying a second literal, so there is one string to keep truthful rather than
two that drift. `SEC_USER_AGENT` still wins wherever it is set — nothing
operational moves. And `.trim()` before the `||`, so a variable set to spaces
falls through to the constant instead of being sent as the identification.

**3. gnews untouched.** Asserted as a **negative**: the Google News adapter must
contain no `user-agent`, with a guard that the comment-stripper did not eat the
file first (a negative assertion against an empty string passes for the wrong
reason). prnewswire does get the header, and the code says in as many words that
**that half is untested** — nothing measured says what prnewswire does with a UA
attached, only that it does not need one.

**4. Content change, not a speed change.** See §7.

### The timeout is now insurance

Kept, and its job restated in the code: it is what bounds **the next** silent
host, not this one. The rationale comment in `lib/server/news/index.ts` that read
*"from Vercel they hang — the same shape as Stooq and Nasdaq refusing this site's
IPs"* has been corrected; it named a cause nobody could act on, which made the
timeout look like the end of the investigation instead of the start.

### Mutation coverage

`scripts/check-news-user-agent.mjs`, **15/15 killed** — including the exact
regression (`newsUserAgent()` becomes `process.env.X ?? ""`), the softer version
of it (env read *with* a good fallback — still configurable, still blankable),
an emptied constant, a dropped header, a misspelled header key, a tidied string,
a second bare fetch added to the adapter, gnews acquiring a UA, and the wires
being coupled back to `SEC_USER_AGENT`.

## 6. §C — configured is not contributed

Unblocked by this fix and shipped with it, because the panel's failure was the
same failure: `/cache-health` read **"gnews + wire + sec"** for two days while
GlobeNewswire returned nothing at all. The line was not wrong — those three are
registered — it was answering a question nobody was asking.

So the panel now carries two rows: **registered** above, **what actually came
back today** below, per adapter, counted from the window the adapters returned
(before dedup: the question is whether it answered, not whether it was first to
the story).

**The three zeroes, and why collapsing any two is a lie.** Redis absent, no
refresh yet today, and an adapter that really did return nothing all render as
`0` if they are merged — and only the third is an alarm. Two false alarms every
morning and in every environment without credentials would retire the one true
one. `classifyProviderStats` returns `unavailable | idle | ok` and the panel
renders a count **only** in the `ok` state.

Every active adapter is also **seeded to zero before counting**, because an
adapter that returned nothing leaves no item to read an id off — without the
seed, "contributed 0" and "not registered" are the same absent field, which is
the precise ambiguity the panel exists to remove.

**A note on how these assertions got written.** The first version of the
three-state check grepped `newsStore.ts` for `status: "idle"` and friends. Those
strings appear in the *type declaration*, so both collapse mutations sailed
through — the assertion was checking spelling. `classifyProviderStats` was split
into a module with no imports specifically so a harness can **call** it. After
that: **10/10 killed**, including both collapses, an all-zeroes hash downgraded
to `idle`, the prefix namespace ignored, and the panel rendering `unavailable`
as `0`.

## 7. What to watch on the first renders — this is a content change

Once the header lands GlobeNewswire actually returns items, so **per-symbol wire
attribution appears for the first time**. Three things are now being exercised
against a source that has never reached them:

- **The pool grows.** More items into merge, dedup and scoring.
- **The churn cap and the 45-day window** are being applied to wire content for
  the first time. Both were tuned on Google News and SEC output.
- **`imageVerdict`'s `allow` path goes live** for wire-credited images. Harmless
  while `SHOW_PUBLISHER_IMAGES` is false — but **that flag is now load-bearing
  in a way it was not yesterday**. It is the master switch above the verdict and
  both must be true to render; until today the verdict never said allow.

**Expected**, and to be measured rather than reported as an estimate: sec ~57ms
+ gnews ~330ms + wire ~200ms concurrent ⇒ a cold stock render around **700ms**,
with the ticker path intact. `MSH_TIMING=1` is already set on Preview; the
per-feed line is `[timing] news wireFeed globenewswire`, and it will now
actually fire, since a settled fetch reaches the `finally`.

## 8. Housekeeping

`app/api/debug/wire-egress` is **deleted** — the verdict is recorded here and the
probe was never a feature. `app/api/debug/static-profile` still awaits its
capture. §D (the `data/cik-map.json` miss rate) remains separate and unstarted.

---

## Appendix — C1, corrected, independent of the above

"Rollback is an env var, not a revert" was being stated as **"no deploy"** in
**four** places, not three. That is wrong: `newsProviderMode()` reads
`process.env`, and an env var changed in the Vercel dashboard does not reach the
running deployment until a **production redeploy** (~2 min, same commit).

The honest claim is: **one env var plus one redeploy; no revert commit, no code
change.**

Corrected in `app/cache-health/page.tsx` (the one that was wrong on a live page),
`lib/server/news/index.ts`, `claude/news-adapter-spec-2026-09-13.md` §7, and
`scripts/check-provider-flip.mjs`, whose own rationale string repeated it. It is
wrong in the worst possible place — the sentence someone reads while deciding
whether the rollback is fast enough to reach for.
