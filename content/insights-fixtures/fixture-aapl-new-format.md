---
title: "Test fixture: Apple and its 50-day average"
date: "2026-09-15"
symbol: "AAPL"
eventType: "level-test"
timeframe: "d"
levels: ["MA50"]
summary: "A test post in the new insight format, for the preview only. It names the 50-day average as the level discussed, so the page draws the move since publication and what the closes did against that average."
why: "The 50-day average is a level many chart readers watch; this fixture uses it to exercise the held / broke readout."
sources:
  - title: "Apple filings on SEC EDGAR"
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-&dateb=&owner=include&count=40"
    publisher: "SEC EDGAR"
bull: "If the closes stay above the 50-day average, the shorter trend may stay intact."
bear: "A run of closes below it might point to the shorter trend weakening."
---

## What happened

This is a fixture, not a published post: it exists so the new template can be previewed end to end and is never listed or indexed. Its one source is Apple's own filing list on [SEC EDGAR](https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-&dateb=&owner=include&count=40). Every figure on the page around it is drawn by the page from stored daily prices and filed figures.
