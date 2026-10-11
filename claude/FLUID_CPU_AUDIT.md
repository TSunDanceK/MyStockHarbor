# MyStockHarbor — Fluid Active CPU Audit (2026-07-09) — mirror

This is a GitHub mirror of the `claude/FLUID_CPU_AUDIT.md` doc kept in the
Claude Project "My Stock Harbor Website". Read-only investigation (no fixes
applied) into why Vercel Hobby-plan Fluid Active CPU usage was running high
(3h48m of the 4h/month cap already used). Top cause: `/api/pickers`'s
per-symbol Redis fan-out (~2.8K Upstash REST calls per page load, no
batching/pipelining). See the Claude Project copy for the full ranked list of
causes and suggested (not yet implemented) fixes.