// The committed curated list (data/capex/receivers.json), typed. Kept apart
// from capexReceivers.ts so the page and the job share one reading of it.
import receiversFile from "@/data/capex/receivers.json";
import type { ReceiverEntry } from "./capexReceivers";

export function receiverEntries(): ReceiverEntry[] {
  return (receiversFile as unknown as { entries: ReceiverEntry[] }).entries;
}

export const RECEIVERS_BUILT_AT: string = (receiversFile as { builtAt: string }).builtAt;
