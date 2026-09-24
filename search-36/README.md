# COWORK #36 ticker search keyboard navigation (throwaway, not for merge)

Rendered locally (`next dev`), 2x scale. Typed "NV", then ArrowDown x3.
- before-*: main. The list opens but the keyboard does nothing, no row highlighted.
- after-*: the fix. Row 3 (NVG) highlighted with a solid tint and ring.
Places: the stock page's "Change stock" box, and the dashboard hero search.
rendered-test-results.txt: 96/96 checks across all 8 boxes.
Local-test-only note: BotID's client fetch wrapper cannot load its challenge in
the sandbox, so the test keeps the browser's native fetch; /pickers gets an empty
picker payload so its box renders without Redis.
