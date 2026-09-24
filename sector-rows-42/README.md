# COWORK #42: sector news 56px rows get a square crop of the generic art (throwaway, not for merge)

Locally the sector page renders no compact rows (the sandbox has no sector news
data), so these render the page's REAL compact-row picture path in a local-only
page (never committed): planCardArt({ variant: "compact", canGenerate: false })
-> withGenericFallback(..., takenGeneric) -> NewsCardArt, at the page's
compactThumbStyle (56x56, objectFit: cover), with sample headlines.

- before-sector-rows-{desktop,phone-390}.png: main's path: 0/5 rows with a picture (blank slot).
- after-sector-rows-{desktop,phone-390}.png: this PR: 5/5, all loaded, 56x56 cover, five different pictures
  (any-macro-01, exchanges-any-08, -06, -04, -07; the -sm 320w files).
