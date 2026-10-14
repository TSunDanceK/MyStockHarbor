// Browser-side consent state: one first-party cookie (accept | reject, six
// months), the region answer from /api/ad-region, and the two events the
// banner, the footer link and the ad rail talk through. Client-only: every
// function guards for a missing window.

export type ConsentChoice = "accept" | "reject";

export const CONSENT_COOKIE = "msh_consent";
export const CONSENT_CHANGED = "msh-consent-changed";
export const CONSENT_OPEN = "msh-consent-open";
const SIX_MONTHS_SECONDS = 60 * 60 * 24 * 182;

export function readConsent(): ConsentChoice | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=(accept|reject)`));
  return m ? (m[1] as ConsentChoice) : null;
}

export function writeConsent(choice: ConsentChoice): void {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${choice}; Max-Age=${SIX_MONTHS_SECONDS}; Path=/; SameSite=Lax${secure}`;
  // Tell Google Consent Mode. The page's default (app/layout.tsx) already set all four to denied for this region.
  const value = choice === "accept" ? "granted" : "denied";
  window.gtag?.("consent", "update", { ad_storage: value, analytics_storage: value, ad_user_data: value, ad_personalization: value });
  if (choice === "reject") clearGoogleCookies();
  window.dispatchEvent(new Event(CONSENT_CHANGED));
}

/** Best effort after a reject that follows an earlier accept: drop the Google analytics / ads cookies this origin holds. */
function clearGoogleCookies(): void {
  for (const part of document.cookie.split("; ")) {
    const name = part.split("=")[0];
    if (name.startsWith("_ga") || name.startsWith("_gcl") || name === "_gid") {
      document.cookie = `${name}=; Max-Age=0; Path=/`;
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.${location.hostname.replace(/^www\./, "")}`;
    }
  }
}

let regionAsk: Promise<boolean> | null = null;

/** Is the visitor in the UK / EU / EEA? One request per page load; false on any failure (no banner, no rail). */
export function askRegion(): Promise<boolean> {
  regionAsk ??= fetch("/api/ad-region", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { inScope: false }))
    .then((j: { inScope?: unknown }) => j.inScope === true)
    .catch(() => false);
  return regionAsk;
}
