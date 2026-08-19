# Picker controls bottom bar — tab-bar restyle (2026-08-19)

Apply to `app/components/PickerResultsGrid.tsx` on top of `616e166`
(the first commit on `feature/picker-controls-bottom-bar`):

```
git apply claude/patches/picker-controls-tab-bar-2026-08-19.patch
```

## Why this exists as a patch rather than a commit

Written, applied locally and `ts.transpileModule`-clean, but not pushed: the
GitHub connector has no patch API, so committing it means re-uploading all 69KB
of `PickerResultsGrid.tsx`, and that was one whole-file upload too many for the
session that produced it. The change itself is finished — this is a transport
limitation, not unfinished work. Applying it locally takes seconds.

## What it does

The first pass docked the four controls to the bottom but left them as pills.
Two problems, both visible in the owner's screenshot:

1. **Pills size to their own labels, so four of them overflowed a 390px
   screen at both ends** — the screener name clipped on the left, "Sort: Stock
   Price" on the right, with nothing indicating either was cut.
2. A pill reads as something you might dismiss. This is the page's permanent
   control surface.

So the bar becomes a real tab bar, matching the treatment used on the
(now-closed) site-wide `BottomNav` in PR #272: equal-width items, icon over
label, flat, no borders. Equal-width items cannot overflow — each takes a
fixed share and its label ellipses inside it.

Per item:

- **Screener** — ScreenerNav renders it as a pill; the border, background and
  radius come off via `.screenerControls`-scoped overrides, so `ScreenerNav.tsx`
  (50KB) is not touched. Its icon becomes the tab glyph, its label the caption,
  the chevron goes. The applied-filter count keeps its green badge, since it is
  the one thing in the bar reporting state rather than offering an action.
- **View mode** — same flattening, and the word comes *back*. A tab bar has room
  for the label that a row of four pills could not afford.
- **Data tab / Sort** — these stay native `<select>`s, because the wheel picker
  is the right control on a phone and nothing here improves on it. The icon is
  drawn by the wrapper's `::before` and the select becomes the caption below it,
  so the shape matches without replacing the control.
- **Sort direction** — sits in the corner of the sort item rather than taking a
  slot of its own; it is a modifier on a sort, not a fifth thing to choose
  between. Deliberately kept as a real 26x22 target: hiding it would leave a
  phone with no way to reverse a sort at all, which the old two-row layout did
  offer.

## Note on the CSS escapes

The two `::before` glyphs are written `content: "\\25A4"` and
`content: "\\21C5"` — double backslash. These sit inside a JS template literal,
so a single backslash is read as an octal escape and fails the build. Same
pattern as `content: "\\2212"` in `app/layout.tsx`.

## Still outstanding on this file

Line 347's decorative `// ── cell formatters` rule has now lost the same two
box-drawing characters on three separate whole-file uploads, caught each time by
the blob-SHA check. Shorten that run of glyphs while applying this patch and it
stops costing an upload every time the file is touched.
