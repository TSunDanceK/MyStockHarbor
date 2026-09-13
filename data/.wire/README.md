# Wire form of the static profile snapshot

The relay emits the snapshot indexed against a sector/industry dictionary,
because the payload travels through a GitHub Actions job log and is copied into
this repo by hand: 2,619 rows of full strings is ~128KB, indexed it is ~29KB.

- `static-profile-dict.json` — the sector and industry dictionaries
- `static-profile-rows-N.txt` — `SYMBOL sectorIndex industryIndex`, one per line

Regenerate with the relay task `static-profile` (one payload per dispatch,
selected by the `symbols` input), then run `scripts/static-profile-expand.mjs`
to rebuild `data/static-profile.json`. **Do not hand-edit either form.**

Every payload is verified twice on arrival: against the total byte count the
emitter declares, and against its per-line byte census. Both are printed by
`scripts/lib/relay-capture.mjs`. The census exists because the total says
"wrong" without saying "where" — it caught an 8-byte slip across 40 lines in an
earlier capture and pointed straight at the two lines responsible.
