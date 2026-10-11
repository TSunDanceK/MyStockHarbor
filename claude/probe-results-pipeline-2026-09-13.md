# Probe results — the pipeline questions answered (2026-09-13, 15:20 UTC)

Smoke run only (`sections=refresh&idxDays=5&condSymbols=1`), from `iad1`, preview, 1.8s.
The env fix worked: `secUserAgent.source: "env"`, `set: true`, `hasContact: true`,
`length: 44`. That length also settles the underscore question — 44 characters is
`MyStockHarbor` + a space + the address. It was a space all along; the edit box renders it
oddly.

**Three of the four pipeline questions are answered. One design assumption is dead, one
recommendation is now optional, and one new failure mode turned up that would have caused
false alarms every public holiday.**

---

## The headline: the change detector works

This was the load-bearing assumption of the whole design, and it holds.

```
www.sec.gov REACHABLE from iad1 — 4 daily index files parsed
Layout stable across every day:  CIK|Company Name|Form Type|Date Filed|File Name
5 columns, no amendment flag, CIK column all-numeric every day
~3,600–4,100 filings/day, 320–365 KB per file
```

And it found real filings for the target symbols in the window:

| Symbol | Date | Form |
|---|---|---|
| ARM | 2026-09-10 | 4, 6-K |
| AAPL | 2026-09-10 | 4 |
| PLAB | 2026-09-10 | **10-Q** |

That PLAB row is the mechanism working end to end: a periodic filing, found by intersecting
one 340 KB file against the universe. **One request a day, and it tells you who moved.**

Amendments are visible verbatim too — `suffixIsVerbatim: true`, 1,225 amended filings over
four days, including 3 × `10-K/A` and 3 × `10-Q/A`. The restatement detector has something
real to match on. Worth noting the shape: `D/A` alone is 616 of those 1,225, and the forms
that actually matter run at roughly **1.5 a day across the whole market**. A very quiet
signal, which is exactly what you want.

---

## The assumption that died: there are no validators

```
lastModified: null
etag:         null
verdict: "NO VALIDATOR OFFERED -- the response carries neither Last-Modified nor
          ETag, so there is nothing to send back. Verify on a rotation, not nightly."
```

`companyfacts` offers neither header, so there is nothing to send back and the negative
controls never even ran — the question was settled one step earlier than expected.

**Consequence for §3 of the spec: the "nightly full-universe verify is nearly free" branch
is dead.** Every verification costs a full payload. ARM's is 720 KB; larger filers will be
multiples of that.

```
700 symbols × ~720 KB          ≈ 500 MB per full sweep
on a 30-day rolling rotation   ≈ 17 MB/day, ~23 symbols/night
```

Perfectly affordable — but it is a rotation, not a nightly sweep, and the spec should say so
rather than leaving the cheap branch in as a possibility.

**Second consequence, and it promotes a Layer that was optional: the content hash is now
load-bearing.** With no validators there is no cheap "has this changed?" question to ask.
The only way to notice a silent restatement is to have written down what you had and compare.
Layer 2 stops being a belt-and-braces extra and becomes the mechanism.

---

## The new failure mode: holidays return 403, not 404

```
20260907 → HTTP 403, 243 bytes → counted as "failed"
```

7 September 2026 was Labor Day. There is no daily index for it, and **SEC answered 403
rather than 404.**

The three-outcome model in 6b is right in principle but mis-buckets this: `absentNoIndex`
only catches 404, so every public holiday lands in `failures` — the bucket that means
"www.sec.gov refused us". A change detector built on this as-is would raise an alarm on
roughly ten days a year, and the day it is really blocked would look identical to Christmas.

Two ways to separate them, and the design should use both:

- **A 403 with a tiny body on a date that is a US market holiday is expected.** 243 bytes
  is an error page, not a refusal of service.
- **A real block would fail every day, not one.** Four of five succeeding *is* the evidence
  that the one failure is about the date, not the IP.

Cheap to handle, ugly to discover in production.

---

## The recommendation that is now optional: `company_tickers.json`

```
status 200 · 797,931 bytes · 10,426 tickers · all 5 symbols resolved
```

**It works from Vercel.** The news probe's 403 on this file was the undeclared-agent block,
not a host block — the same fair-access page that made every SEC call fail earlier today.
With a declared User-Agent it returns fine.

So §7b's "commit it as a static file because it 403s" is **wrong as stated**. Committing it
is still worth doing, but for the other reason given there: it is the **allowlist gate**
that makes an unknown ticker 404 before any network call, which is what bounds the cold-fetch
exposure at ~10,000 and keeps a scraper from being able to trigger anything. Same
conclusion, different justification — and the justification matters, because "it 403s" would
have been quietly wrong in six months.

Also note 10,426 tickers, which is the real number behind the abuse arithmetic in §7f.

---

## Inconclusive: the bulk archives (6d)

All four candidates failed, but two of them failed *in our code*:

```
xbrl/companyfacts.zip      RangeError: offset out of range, <= 65534, received 65536
bulkdata/submissions.zip   RangeError: offset out of range, <= 65534, received 65552
bulkdata/companyfacts.zip  403
xbrl/submissions.zip       403
```

**The two RangeErrors are the good news.** A crash while parsing a ZIP central directory
means bytes came back — those two paths are reachable and are the correct ones. The two
403s are the swapped paths, i.e. wrong guesses, exactly as the probe was designed to reveal.

So 6d needs one bug fix and a re-run, not a redesign.

---

## What this changes in the spec

| Spec section | Status |
|---|---|
| §1 change detector — one request a day | **confirmed** |
| §3 Layer 1, amendments from the index | **confirmed**, `/A` verbatim |
| §3 Layer 2, content hash | **promoted from optional to load-bearing** |
| §3 Layer 3, nightly conditional verify | **dead** — rotation only, ~23 symbols/night |
| §7b, commit tickers file because it 403s | **justification wrong**, keep the file as the abuse gate |
| §7d, cold-render payload size | **answered** — 720 KB for ARM, so queue-and-drain stands |
| 6b holiday handling | **new requirement**, not previously identified |
| §4 bulk vs per-symbol backfill | still open, pending the 6d fix |

---

## Next

1. **Fix 6d and re-run it** — instruction below.
2. **Run the default sections** — the hide list, still the biggest open question and
   untouched so far.
3. **Run `sections=datasets`** after it, since the month derives from run 2.
4. The full 30-day `sections=refresh` is now **low value**: 6c already answered verbatim on
   four days with 1,225 amendments. Run it if convenient, but it decides nothing.
