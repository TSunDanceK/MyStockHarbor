// "SEC DATA LOADED" (#552 COWORK #46): the announcement, held OUTSIDE the
// component that makes it. The cold-fill block is replaced by the figures on
// the very refresh it triggers, so the notice lives in the stock layout
// (SecLoadedNotice), which the refresh keeps mounted. A module-level store,
// read with useSyncExternalStore.
let announcedAt = 0;
const listeners = new Set<() => void>();

/** How long the notice stays on screen. */
export const SEC_LOADED_NOTICE_MS = 4_000;
export const SEC_LOADED_WORDS = "SEC data loaded";

export function announceSecLoaded(now: number = Date.now()): void {
  announcedAt = now;
  for (const l of listeners) l();
}
export function subscribeSecLoaded(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
export const secLoadedAt = (): number => announcedAt;
