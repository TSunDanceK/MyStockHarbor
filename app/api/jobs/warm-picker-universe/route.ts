// app/api/jobs/warm-picker-universe/route.ts
//
// Thin re-export — all build logic lives in lib/server/pickersBuilder.ts,
// shared with /api/pickers so the two entry points can never drift out of
// sync again. This route exists as a distinct URL purely so the daily
// GitHub Actions warm-up workflow (see PICKERS_EARNINGS_WARM_AUTOMATION.md,
// project doc) has a clearly-named target to hit and so Vercel logs/
// Observability can distinguish scheduled warm-up hits from organic
// traffic — the underlying handler is identical to /api/pickers.
export const dynamic = "force-dynamic";

export { GET } from "../../../../lib/server/pickersBuilder";
