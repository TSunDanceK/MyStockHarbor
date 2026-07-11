// app/api/pickers/route.ts
//
// Thin re-export — all build logic lives in lib/server/pickersBuilder.ts,
// shared with /api/jobs/warm-picker-universe so the two entry points can
// never drift out of sync again (see that module's header comment and
// CACHING_REFRESH_ARCHITECTURE_PLAN.md for the history).
export const dynamic = "force-dynamic";

export { GET } from "../../../lib/server/pickersBuilder";
