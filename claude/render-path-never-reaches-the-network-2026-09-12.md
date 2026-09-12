# A cache miss at render time must never reach the network

Owner's design rule, set 2026-09-12, to be stated explicitly in the Stooq/SEC
adapter when it is written. Not in any earlier brief.

## The rule

**After the swap, a cache miss on a render path returns degraded. It does not
fetch.** The bulk file is the only thing that writes bars.

## Why this is the decision and not an implementation detail

Today `getDailyHistory(symbol)` calls FMP on a Redis miss. **That is the only
reason a builder can stampede an upstream at all.** Remove it and the whole class
of failure goes with it — the render path can no longer originate an outbound
request, however many concurrent requests arrive on a cold cache.

After the swap a miss has three possible behaviours, and only one is correct:

| Behaviour | Verdict |
|---|---|
| Return degraded, no network | **CORRECT.** The bulk file is the only writer. |
| Fetch that one symbol from Stooq | Per-symbol requests on a render path — the exact pattern suspected of getting an earlier build served **HTML instead of CSV** once Stooq's daily per-IP limit was hit. |
| Re-parse the bulk file | A several-hundred-MB page render. |

**The middle one is what gets written if nobody decides otherwise**, because it is
the smallest diff from the current code: `getDailyHistory` already has a
fetch-on-miss branch, and swapping the URL inside it looks like the whole job.
That is why this is written down before the adapter exists rather than after.

Note the shape: the wrong option is not obviously wrong at the call site. It is
one symbol, one request, on a path that already did exactly that with a different
vendor. It only becomes visible as a failure at the scale a cold cache produces,
which is the same reason the plays builders' missing single-flight sat unnoticed
for twelve days (`claude/plays-builders-missing-single-flight-2026-09-12.md`).

## Consequence: the FMP pacing guard shrinks, it does not transfer

This is the part that would be got wrong by porting rather than deciding.

Renders stop calling out, so **nothing on a render path needs pacing any more**.
The call-slot reservation, the minute-bucket guard and the capacity waits in
`historyCache.ts` exist to keep a render-triggered fetch inside FMP's per-minute
allowance. With no render-triggered fetch, they are guarding nothing.

**The only thing left that needs a rate limit is the SEC ingest** — roughly 700
per-company `companyfacts` calls at SEC's documented ≤10 requests/second, with a
declared `User-Agent` carrying a real contact address.

**Pace it inside that job, not in `historyCache`.** A limiter living in the
history module would be a limiter on a path that no longer fetches, sized for a
vendor that is no longer called, and it would read as load-bearing to whoever
found it next. The ingest job knows its own request budget; the cache does not
need to.

## What to write in the adapter

State the rule at the point where the miss is handled, not only here — a doc that
records a decision the code does not mention is a decision the next session
re-litigates. Name which of the three behaviours was chosen and why the other two
were rejected, so a future change that reintroduces a fetch has to argue with
something.

## Related

- `claude/plays-builders-missing-single-flight-2026-09-12.md` — the cold-cache
  stampede this rule makes structurally impossible rather than merely bounded.
- `claude/traps/a-defect-found-in-one-file-lives-in-its-siblings.md` — if a
  fetch-on-miss branch survives anywhere, check every reader for the same shape
  before calling it removed.
