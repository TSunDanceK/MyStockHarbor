// Browser storage that never throws (#553 COWORK #33).
//
// THE CRASH. With site data blocked (some privacy modes, some embedded
// browsers), merely READING `window.localStorage` throws a SecurityError --
// before any `.getItem` call a helper might have wrapped. SiteHeader read it
// bare in an effect, so every page on the site crashed for those visitors.
//
// Every read and write goes through here; each is inside a try. A caller gets
// null / false back, and the page carries on without remembering.

/** The browser's localStorage, or null (server, or storage blocked). */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A stored value, or null when absent, on the server, or when storage throws. */
export function readStored(key: string, storage: Pick<Storage, "getItem"> | null = browserStorage()): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Store a value; false when storage is absent or throws (quota, blocked). */
export function writeStored(key: string, value: string, storage: Pick<Storage, "setItem"> | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
