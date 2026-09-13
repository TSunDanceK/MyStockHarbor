# Probe complete — three answers, one over-claimed verdict (2026-09-13, 15:42 UTC)

Both runs clean from `iad1`. 6b, 6c and 6d are now settled. The datasets section ran end to
end for the first time and returned a verdict that **claims more than its own evidence
supports** — §1.

> **Superseded in part by `claude/segments-answered-2026-09-13.md`.** §1's INCONCLUSIVE call
> was right; the cause was not. The join key column was `dimhash` against `num.tsv`'s
> `dimh`, and once fixed the segment data was all present.

---

## 1. Segment revenue — the probe says NO-GO, and it should say INCONCLUSIVE

Discovery worked, and it found the reason for yesterday's 404 immediately:

```
constructed (mine):  /files/dera/data/financial-statement-and-notes-data-sets/...
discovered (real):   /files/dera/data/financial-statement-notes-data-sets/...
                                       ^^^ no "and"
```

Everything downstream then ran properly — 93 MB archive, `accept-ranges: bytes`, ten
entries, AAPL's 10-K located in `sub.tsv`, and `num.tsv` **read in full**: 1,680,427 rows,
261 MB inflated, 3.3 seconds, not truncated.

Then:

```
rowsForTarget             969
revenueRowsKept            64
undimensionedRevenueRows   64
distinctDimensionHashes    18
E_dim resolved              0   of 18
verdict: "NO-GO ... no dimensioned revenue rows on these axes exist in it"
```

**Zero of eighteen resolved is a join-failure signature, not an absence signature.** If the
dimensions were genuinely irrelevant axes you would expect them to resolve and then be
filtered out as the wrong axis. Resolving *none* of them means the `NUM.dimh → DIM.dimhash`
lookup itself is not matching.

And the independent check says the same thing: **Apple discloses revenue by product and by
geography in every 10-K.** Those disclosures are in the filing this stage just located. A
result saying they are not in the dataset is far more likely to be a lookup problem than a
fact about Apple.

**This section is not finished.** Everything mechanical about it works; the classification
step is what needs another pass.

---

## 2. The holiday classifier works, and the body explains why

```
29 parsed · 1 absentNoIndex · 0 failed
verdict: "noPublication"
```

And the 403 body is the part worth keeping:

```xml
<Error><Code>AccessDenied</Code><Message>Access Denied</Message>
<RequestId>...</RequestId><HostId>...</HostId></Error>
```

That is **Amazon S3**, not SEC. EDGAR's daily-index files are served from an S3 bucket that
does not grant `ListBucket`, and S3 returns `AccessDenied` rather than `NoSuchKey` for a
missing object precisely so that a caller cannot probe for which keys exist.

So the 403-on-holidays behaviour is not a quirk, an outage, or something that might change
next month — it is standard S3 semantics and it will be stable. Worth recording once so
nobody re-investigates it.

**The carry-over to production still stands, and it is the one thing here that does not
transfer.** The probe classifies by *window spread* — 29 days parsed, so the one 403 is a
holiday. The live daily job fetches exactly one file a day and has no spread. Re-express it
across time: **alarm on consecutive 403s, never on one.** A single 403 should retry
tomorrow, silently.

---

## 3. Amendments, over a proper 30-day window

```
160,737 filings · 12,637 amended · 305 distinct form types
10-K/A  28      10-Q/A  44        20-F/A  8
```

Roughly one 10-K/A and one and a half 10-Q/A per day across the entire market, plus 8
20-F/A for the foreign private issuers. `suffixIsVerbatim: true`.

Layer 1 has a real signal at a workable volume — a couple of restatement events a day to
check against the registry, not thousands.

---

## 4. The bulk archives — answered, and one of them is very useful

```
companyfacts.zip   /Archives/edgar/daily-index/xbrl/companyfacts.zip
                   1,343.5 MB · classic zip · 20,359 entries
                   central directory 1.7 MB · accept-ranges: bytes

submissions.zip    /Archives/edgar/daily-index/bulkdata/submissions.zip
                   1,490.9 MB · ZIP64 · 990,026 entries
                   central directory 83.2 MB · accept-ranges: bytes
```

Both republished 2026-09-12 ~04:2x UTC, matching SEC's stated ~03:00 ET nightly rebuild.
The two 403s are the swapped paths — so the paths are `xbrl/` for companyfacts and
`bulkdata/` for submissions, not interchangeable.

`submissions.zip` genuinely is ZIP64, with 990,026 entries — well past the 65,535 that
classic ZIP can address. That had nothing to do with the earlier RangeError, which was our
own truncated-buffer walk.

### The finding worth acting on

`companyfacts.zip` has a **1.7 MB central directory and supports range requests**. That
makes it a random-access store over HTTP: fetch the directory once, cache it, and every
company's facts become a byte range in a static file that is rebuilt nightly.

For the cold start that is the difference between one arrangement and 10,426 API calls.
A 1.34 GB download will not fit in a Vercel function, but it does not have to — with
`accept-ranges` the backfill can stream entry by entry across many invocations at whatever
rate the drain sets.

**`submissions.zip` is not worth using.** An 83 MB central directory to reach data that is
only ever needed per-symbol on an event, which the per-symbol endpoint already serves in
25 KB. Skip it.

---

## 5. Where everything stands now

| Question | Status |
|---|---|
| Daily index reachable, layout stable | **settled** |
| Holidays vs blocks | **settled** — S3 semantics; production needs consecutive-403 logic |
| `/A` amendments visible | **settled** — ~2/day market-wide |
| Conditional requests | **settled** — none offered, rotation not nightly |
| Bulk archives | **settled** — companyfacts via range reads; skip submissions |
| Per-filer tag availability | **settled** — no site-wide hide list, chains needed |
| Cash flow quarterly | **settled** — YTD differencing required |
| Filing timestamp timezone | **settled** — read as UTC, don't use the fit |
| **Segment revenue** | settled shortly after this doc — see `segments-answered` |
| Analyst consensus | the only true gap, and it is a vendor question |
