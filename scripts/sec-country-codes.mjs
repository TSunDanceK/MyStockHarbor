// EDGAR'S STATE/COUNTRY CODES → data/sec/edgar-location-codes.json
//
// SEC submissions carry `addresses.business.stateOrCountry` in EDGAR's own
// code list: US states by their postal code, everything else by a two-
// character code of SEC's (A0-B0 Canadian provinces, "I0" France, "X0" United
// Kingdom, ...). The /stock page's Country row needs those as countries, and
// a hand-typed table of ~300 codes would be ~300 chances to put a company in
// the wrong country. So the table is SEC's, fetched here, and the ISO-3166
// alpha-2 code is attached by matching SEC's country NAME against the
// runtime's own ISO name table (Intl.DisplayNames) — never typed. Names that
// do not match are listed, not guessed.
//
// Read-only, no credentials. Prints the JSON into the log for the session.
import fs from "node:fs";

const UA = process.env.SEC_USER_AGENT ||
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; edgar location codes)";
const URLS = [
  "https://www.sec.gov/submit-filings/filer-support-resources/edgar-state-country-codes",
  "https://www.sec.gov/edgar/searchedgar/edgarstatecodes.htm",
];

let html = null, from = null;
for (const url of URLS) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } }).catch((e) => ({ ok: false, status: e.message }));
  console.log(`  ${url} -> ${res.status}`);
  if (res.ok) { html = await res.text(); from = url; break; }
}
if (!html) { console.error("FATAL: no source answered"); process.exit(1); }

const text = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const rows = [];
for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
  const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(text);
  if (cells.length >= 2 && /^[A-Z0-9]{2}$/.test(cells[0]) && cells[1]) rows.push([cells[0], cells[1]]);
}
console.log(`  parsed ${rows.length} code rows from ${from}`);
if (rows.length < 200) { console.error("FATAL: too few rows — the page layout is not the one this parser expects"); console.log(html.slice(0, 3000)); process.exit(1); }

const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
const display = new Intl.DisplayNames(["en"], { type: "region" });
const norm = (s) => s.toUpperCase().replace(/\(.*?\)/g, "").replace(/[^A-Z]/g, "");
// FIRST MATCH WINS, AND THAT IS LOAD-BEARING. Intl.DisplayNames also names
// RETIRED codes — FX "Metropolitan France", UK, YU, DY, HV, TP — and a
// last-write-wins loop gave France FX and the United Kingdom UK on the first
// run (relay 35773438440). Walking AA..ZZ and keeping the first code per name
// keeps FR, GB, RS, BJ, BF, TL, because each current code sorts before the
// retired one it replaced. Checked below rather than assumed.
const isoByName = new Map();
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const iso = String.fromCharCode(a, b);
  const name = display.of(iso);
  if (name && name !== iso && !isoByName.has(norm(name))) isoByName.set(norm(name), iso);
}
for (const [name, want] of [["France", "FR"], ["United Kingdom", "GB"], ["Serbia", "RS"], ["Benin", "BJ"], ["Burkina Faso", "BF"], ["Timor-Leste", "TL"]]) {
  if (isoByName.get(norm(name)) !== want) { console.error(`FATAL: ${name} resolved to ${isoByName.get(norm(name))}, not ${want}`); process.exit(1); }
}

// SEC'S OLDER NAME → THE NAME Intl USES, for the rows the first run could not
// match. A RENAME LIST, not a code table: every entry still resolves through
// Intl, so a typo here yields null (and is listed), never a wrong code. Only
// names that are the same country under a different spelling are here —
// territories whose status differs (Netherlands Antilles, "UNKNOWN") stay null.
const RENAMES = {
  "ANTIGUA AND BARBUDA": "Antigua & Barbuda",
  "BOSNIA AND HERZEGOVINA": "Bosnia & Herzegovina",
  "BRUNEI DARUSSALAM": "Brunei",
  "CONGO": "Congo - Brazzaville",
  "CONGO, THE DEMOCRATIC REPUBLIC OF THE": "Congo - Kinshasa",
  "COTE D'IVOIRE": "Côte d’Ivoire",
  "CZECH REPUBLIC": "Czechia",
  "HONG KONG": "Hong Kong SAR China",
  "IRAN, ISLAMIC REPUBLIC OF": "Iran",
  "KAZAKSTAN": "Kazakhstan",
  "KOREA, DEMOCRATIC PEOPLE'S REPUBLIC OF": "North Korea",
  "KOREA, REPUBLIC OF": "South Korea",
  "LAO PEOPLE'S DEMOCRATIC REPUBLIC": "Laos",
  "LIBYAN ARAB JAMAHIRIYA": "Libya",
  "MACAU": "Macao SAR China",
  "MACEDONIA, THE FORMER YUGOSLAV REPUBLIC OF": "North Macedonia",
  "MICRONESIA, FEDERATED STATES OF": "Micronesia",
  "MOLDOVA, REPUBLIC OF": "Moldova",
  "PALESTINIAN TERRITORY, OCCUPIED": "Palestinian Territories",
  "RUSSIAN FEDERATION": "Russia",
  "SAINT KITTS AND NEVIS": "St. Kitts & Nevis",
  "SAINT LUCIA": "St. Lucia",
  "SAINT VINCENT AND THE GRENADINES": "St. Vincent & Grenadines",
  "SAO TOME AND PRINCIPE": "São Tomé & Príncipe",
  "SWAZILAND": "Eswatini",
  "SYRIAN ARAB REPUBLIC": "Syria",
  "TANZANIA, UNITED REPUBLIC OF": "Tanzania",
  "TRINIDAD AND TOBAGO": "Trinidad & Tobago",
  "TURKEY": "Türkiye",
  "TURKS AND CAICOS ISLANDS": "Turks & Caicos Islands",
  "VIRGIN ISLANDS, BRITISH": "British Virgin Islands",
  "VIRGIN ISLANDS, U.S.": "U.S. Virgin Islands",
};

const codes = {};
const unmatched = [];
for (const [code, name] of rows) {
  if (US_STATES.has(code)) { codes[code] = { name: "United States", iso: "US", region: name }; continue; }
  // A CANADIAN PROVINCE IS CANADA. SEC codes each province separately
  // ("A6" = "ONTARIO, CANADA"); the country is the part after the comma.
  const province = /^(.+), CANADA$/.exec(name);
  const lookup = province ? "Canada" : RENAMES[name] ?? name;
  const iso = isoByName.get(norm(lookup)) ?? null;
  codes[code] = { name: province ? "CANADA" : name, iso, region: province ? province[1] : null };
  if (!iso) unmatched.push(`${code}=${name}`);
}
const file = {
  _comment: `EDGAR state/country codes from ${from}, fetched ${new Date().toISOString().slice(0, 10)}. ` +
    "US state codes map to United States. iso is ISO-3166 alpha-2, attached by matching SEC's " +
    "country name against Intl.DisplayNames — null where the names did not match (never guessed).",
  source: from,
  codes,
};
const json = JSON.stringify(file, null, 1) + "\n";
fs.mkdirSync("data/sec", { recursive: true });
fs.writeFileSync("data/sec/edgar-location-codes.json", json);
console.log(`  unmatched names (${unmatched.length}): ${unmatched.join(" | ")}`);
console.log("===LOCATION-CODES-BEGIN===");
console.log(JSON.stringify(file));
console.log("===LOCATION-CODES-END===");
