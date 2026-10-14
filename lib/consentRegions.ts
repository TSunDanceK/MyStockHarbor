// UK + EU/EEA visitors: the places where the cookie banner shows and the
// partner-ad rail may appear (owner request, #553, 14 Oct). Country codes as
// Vercel's x-vercel-ip-country header and Google Consent Mode's `region`
// setting both spell them. EU-27, then Iceland / Liechtenstein / Norway
// (EEA), then the UK.
export const CONSENT_REGIONS: readonly string[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO",
  "GB",
];

export function isConsentRegion(country: string | null | undefined): boolean {
  return !!country && CONSENT_REGIONS.includes(country.trim().toUpperCase());
}
