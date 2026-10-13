// A symbol's sector from the committed SIC profile: the insight page's and the
// Bottleneck page's breadcrumb (#563 COWORK #158). Committed files only, 0 commands.
import { sicProfileFor } from "@/lib/server/staticProfile";
import { getSectorByLabel } from "@/lib/sectors";

export function sectorOf(symbol: string): { name: string; slug: string | null } | null {
  const label = sicProfileFor(symbol)?.sector ?? null;
  if (!label) return null;
  const def = getSectorByLabel(label);
  return { name: def?.shortName ?? label, slug: def?.slug ?? null };
}
