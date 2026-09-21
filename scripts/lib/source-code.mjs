// Comment stripping for the check-*.mjs harnesses, with a guard that the strip
// did not eat the subject.
//
// WHY THIS IS A SHARED MODULE AND NOT SIXTEEN COPIES OF A REGEX.
//
// Every harness that asks "does the code do X" has to read the source with
// comments removed, because otherwise the prose describing a bug satisfies the
// assertion about the bug (claude/traps/grep-finds-the-comment-not-the-code.md).
// Sixteen of them grew the same regex independently:
//
//   src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//"))
//
// That regex has no idea what a string is. lib/server/historyCache.ts sends an
// Accept header containing `*/*`; its `*/` closes whatever block comment came
// before it and its `/*` opens a new one, so the strip silently deleted 12,773
// of 40,647 characters -- a third of the file, including every line the
// assertions were about.
//
// THE FAILURE DIRECTION IS WHAT MAKES THIS WORTH A MODULE. A stripper that eats
// the file makes POSITIVE assertions fail loudly, which is survivable. It makes
// NEGATIVE assertions -- "this string does not appear", "this pattern is gone",
// "nothing here imports X" -- pass, because nothing appears in text that was
// deleted. Those are the assertions that guard against regressions, and they
// fail green. A harness reading its subject through a broken filter reports the
// filter, not the subject.
//
// TWO DEFENCES, and the second is the one that generalises:
//
//   1. Strip with the TypeScript scanner, which knows what a string is.
//   2. Assert afterwards that the strip did not eat too much -- independently of
//      the mechanism that did the stripping. If the scanner is ever replaced,
//      or a harness rolls its own again, assertStripKeptTheCode still catches it.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const scriptKindFor = (file) =>
  file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TS;

/**
 * Every identifier and string literal the file actually contains, WITH COUNTS,
 * taken from the AST.
 *
 * These are the markers. They come from PARSING (ts.createSourceFile), which is
 * a different mechanism from the strip -- so this is independent evidence, not
 * the stripper marking its own homework. Anything the parser reports as an
 * identifier or a string literal is by definition outside every comment, so a
 * strip that removed one removed real code.
 *
 * COUNTS, NOT PRESENCE, and that distinction has teeth. A first version asked
 * only "does this name still appear somewhere". Calibration showed it missed a
 * 400-character bite taken out of `parseFmpHistoricalRows`: the declaration went,
 * but the name still appeared at its call site, so presence was satisfied while
 * the function body was gone. Counting occurrences catches a bite at any one of
 * several sites.
 *
 * EVERY OCCURRENCE, NOT JUST DECLARATIONS, for the same reason -- a declaration
 * count of 1 is satisfied by the surviving call.
 */
export function outsideCommentMarkers(text, file) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const counts = new Map();
  const bump = (k) => counts.set(k, (counts.get(k) ?? 0) + 1);

  const visit = (n) => {
    // Short names occur inside ordinary prose, which would make this assert
    // nothing; they are dropped rather than weakening every check.
    if (ts.isIdentifier(n) && n.text.length >= 6) bump(n.text);
    if (ts.isStringLiteral(n) && n.text.length >= 6) bump(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return counts;
}

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

/**
 * Throws if the stripped text lost markers that cannot have been comments, or
 * came back essentially empty.
 *
 * THE MARKER CHECK IS THE ONE THAT WORKS, and the fraction floor is deliberately
 * almost-off. A first version set the floor at 20% and it immediately produced a
 * FALSE ALARM: app/stock/[symbol]/layout.tsx is genuinely 92% comment lines, so
 * a correct strip legitimately returns 8% of it. That cuts both ways -- the bug
 * that prompted all of this retained 68.6% of its file, which no plausible
 * fraction would have rejected either. A fraction cannot separate "this file is
 * mostly prose" from "the stripper ate the code"; only the markers can.
 *
 * So the floor stays purely as a catastrophic backstop (a strip that returns
 * nothing at all from a file that had code), and the markers do the work.
 */
export function assertStripKeptTheCode(raw, stripped, file, minRetainedFraction = 0.02) {
  const markers = outsideCommentMarkers(raw, file);
  const lost = [];

  for (const [name, astCount] of markers) {
    // SELF-CALIBRATED PER MARKER. A string literal's parsed text need not appear
    // verbatim in the source (escapes, quote styles, line continuations). If the
    // raw text does not itself contain the marker at least as often as the AST
    // says, this marker cannot be counted reliably and is skipped -- better than
    // a guard that cries wolf on every file containing an escaped quote.
    if (occurrences(raw, name) < astCount) continue;
    const got = occurrences(stripped, name);
    if (got < astCount) lost.push(`${JSON.stringify(name)} ${got}/${astCount}`);
  }

  if (lost.length) {
    throw new Error(
      `comment strip ATE CODE in ${file}: ${lost.length} of ${markers.size} parsed ` +
        `identifiers/string literals lost occurrences (${lost.slice(0, 6).join(", ")}). ` +
        `Every negative assertion made against this text would pass for the wrong reason.`
    );
  }

  const dense = (s) => s.replace(/\s+/g, "").length;
  const kept = dense(raw) === 0 ? 1 : dense(stripped) / dense(raw);
  if (markers.size > 0 && kept < minRetainedFraction) {
    throw new Error(
      `comment strip returned essentially nothing from ${file} (${(kept * 100).toFixed(1)}% of its ` +
        `non-whitespace characters) despite the file parsing to ${markers.size} markers. ` +
        `Refusing to run assertions against it.`
    );
  }

  return { markers: markers.size, keptFraction: kept };
}

/**
 * Strip comments using the PARSER's own comment ranges.
 *
 * NOT ts.createScanner, and the reason is a bug this module's own guard caught
 * before it shipped. A raw scanner has no parser state, so it cannot follow a
 * template literal with substitutions: given
 *
 *   openGraph: { title: `${clean} Earnings | MyStockHarbor`, type: "article", ... }
 *
 * it reads `${clean}` as the head, loses the thread at the `}`, and treats the
 * NEXT backtick as the start of a fresh template -- swallowing everything up to
 * the following one, including `type: "article"`. That is the same class of
 * mistake as the regex it replaced (a lexer without enough context to know what
 * it is looking at), just further down the ladder.
 *
 * ts.getLeadingCommentRanges applied at every token's full start is complete:
 * every comment in a parseable file is leading trivia of exactly one token, and
 * the EndOfFileToken carries the ones at the bottom. The parser handles template
 * literals, JSX, regex literals and strings correctly because it is the parser.
 *
 * `dropLines` reproduces the two shapes the harnesses already used: some blanked
 * comment lines in place (preserving line numbers for line-anchored assertions),
 * others dropped them. Kept as an option rather than unified, so moving a
 * harness onto this module is not also a silent behaviour change.
 */
export function stripComments(text, { file, dropLines = false, minRetainedFraction = 0.02 } = {}) {
  // REQUIRED, NOT DEFAULTED. `file` chooses the ScriptKind, and parsing a .tsx
  // file as .ts silently mis-reads its JSX -- which moves the comment ranges and
  // blanks real code. A default of "source.ts" made that the QUIET outcome for
  // any caller that forgot to pass a path, which is precisely the class of
  // failure this module exists to end. Callers must say what they are reading.
  if (typeof file !== "string" || !file) {
    throw new Error("stripComments: `file` is required — it selects the parser (.ts vs .tsx).");
  }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));

  // LEADING **AND** TRAILING, and the second is not optional.
  // ts.getLeadingCommentRanges deliberately EXCLUDES a comment that sits on the
  // same line as preceding code -- that is what getTrailingCommentRanges is for.
  // Collecting only the leading ones left every `const x = 1; // explanation`
  // in place, which is the original trap exactly: an assertion asking whether
  // the code does X, satisfied by the comment saying it does. A synthetic
  // fixture caught it; none of the real-file fixtures would have, because the
  // file they read has no inline comments at all.
  const ranges = [];
  const collect = (node) => {
    const kids = node.getChildren(sf);
    if (kids.length === 0) {
      for (const r of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) ranges.push(r);
      for (const r of ts.getTrailingCommentRanges(text, node.getEnd()) ?? []) ranges.push(r);
      return;
    }
    for (const k of kids) collect(k);
  };
  collect(sf);

  // Blank each comment in place, preserving newlines so line-anchored
  // assertions keep their meaning.
  //
  // BUILT BY SLICING, NOT BY INDEXING A SPREAD ARRAY. `[...text]` splits by CODE
  // POINT, so a single non-BMP character (this repo has emoji in its UI strings)
  // makes every subsequent array index disagree with the string offsets the
  // parser reported -- and the blanking lands on the wrong region. It cost a
  // `useEffect` in app/components/MobileHomePage.tsx, and the marker guard is
  // what caught it. String.prototype.slice uses UTF-16 offsets, the same units
  // ts comment ranges are expressed in.
  const sorted = [...ranges].sort((a, b) => a.pos - b.pos);
  let out = "";
  let cursor = 0;
  for (const r of sorted) {
    if (r.pos < cursor) continue; // overlapping/duplicate range, already covered
    out += text.slice(cursor, r.pos);
    out += text.slice(r.pos, r.end).replace(/[^\n]/g, " ");
    cursor = r.end;
  }
  out += text.slice(cursor);

  // `dropLines` drops only lines the STRIP emptied, not lines that were already
  // blank. The originals dropped comment lines and kept blank ones, and a
  // migration that also swallowed blank lines would change the text every
  // multiline regex in these harnesses is matched against.
  const rawLines = text.split("\n");
  const result = dropLines
    ? out
        .split("\n")
        .filter((l, i) => l.trim() !== "" || (rawLines[i] ?? "").trim() === "")
        .join("\n")
    : out;

  // Guarded on the way out, so no caller can forget to.
  assertStripKeptTheCode(text, result, file, minRetainedFraction);
  return result;
}

/** Read a repo file and strip its comments in one step. */
/**
 * One exported `const NAME = ...;` from a module, without the module.
 *
 * WHY A MODULE CANNOT SIMPLY BE CONCATENATED. secReportDates declares
 * `const DAY = 86400000` and so does secExtract, so a harness that inlines
 * both turns two correct modules into "Identifier 'DAY' has already been
 * declared". render-snapshot.mjs hit that first and grew a local copy of this
 * helper; check-sec-valuation.mjs then needed the same thing for
 * DEADLINE_FALLBACK, and a second copy of a helper about not keeping two
 * copies of a value would have been its own joke. One definition, both
 * callers.
 *
 * TWO SHAPES, AND THE ORDER BETWEEN THEM IS DECIDED BY THE FIRST LINE, not by
 * which pattern is tried first. Both orders are wrong as a blanket rule:
 *
 *   multi-line first  a one-liner has no `\n};` of its own, so the pattern runs
 *                     ON to the next one and swallows whatever sits between.
 *                     DEADLINE_FALLBACK did exactly this, absorbing the code
 *                     after it and producing "FILING_DEADLINE_DAYS is read but
 *                     never declared" from a lift that looked fine.
 *   one-line first    a table's opening line matches and returns a fragment
 *                     that parses as valid JavaScript while meaning something
 *                     else.
 *
 * So the first line decides: if it ends in `;` the declaration is complete
 * there, and only otherwise is the multi-line form used. That is a property of
 * the text rather than a guess about which shape is more common.
 *
 * THROWS RATHER THAN RETURNING EMPTY. A miss would drop the declaration
 * silently, the lift's closure check would report the name as undeclared, and
 * the next reader would "fix" that by pinning a literal -- which is the thing
 * these helpers exist to prevent.
 *
 * `export` is stripped, because callers concatenate into a unit that declares
 * its own exports.
 */
export function grabConst(file, name) {
  const src = fs.readFileSync(file, "utf8");
  const firstLine = (src.match(new RegExp(`^export const ${name}[^=]*=.*$`, "m")) ?? [])[0];
  const complete = firstLine != null && /;\s*$/.test(firstLine);
  const found = complete
    ? firstLine
    : (src.match(new RegExp(`^export const ${name}[^=]*=[\\s\\S]*?\\n\\};$`, "m")) ?? [])[0];
  if (!found) throw new Error(`grabConst: ${name} not found in ${file} — renamed, or no longer exported`);
  return found.replace(/^export /, "");
}

export function readCodeOnly(relPath, opts = {}) {
  const full = path.join(process.cwd(), relPath);
  return stripComments(fs.readFileSync(full, "utf8"), { file: relPath, ...opts });
}

/**
 * lib/server/news/eventType.ts, de-typed and with its exports stripped, ready to
 * be substituted in place of an adapter's `import ... from "./eventType"` line.
 *
 * WHY IT IS SHARED. Three adapters import the cascade, so three harnesses need
 * the same substitution. Written out three times it would rot in three places at
 * different rates — and a substitution that silently stops matching is exactly
 * the failure this idiom already had once (a stub that quietly stopped applying
 * while every assertion kept passing). One copy, one thing to fix.
 *
 * The caller still has to guard that the result landed: check for
 * "function deriveEventType" in the inlined source and fail loudly if it is
 * absent, rather than loading a module with a missing binding.
 */
export function eventTypeSource() {
  return readCodeOnly("lib/server/news/eventType.ts", { dropLines: false })
    .replace(/^import type \{ NewsItem \} from ".\/types";$/m, "")
    .replace(/^export type EventType = NonNullable<NewsItem\["eventType"\]>;$/m, "")
    .replace(/^export type EventTypeLeg = .*$/m, "")
    .replace(/^export type EventTypeInputs = \{[\s\S]*?^\};$/m, "")
    .replace(/const ITEM_EVENT_TYPES: Record<string, EventType>/, "const ITEM_EVENT_TYPES")
    .replace(/const (FORM|SUBJECT|TITLE)_EVENT_TYPES: Array<\[RegExp, EventType\]>/g, "const $1_EVENT_TYPES")
    .replace(/export function eventTypeFromForm\(form: string, items: string\): EventType/, "function eventTypeFromForm(form, items)")
    .replace(/export function eventTypeFromSubjects\(subjects: string\[\]\): EventType \| null/, "function eventTypeFromSubjects(subjects)")
    .replace(/export function eventTypeFromTitle\(title: string\): EventType \| null/, "function eventTypeFromTitle(title)")
    .replace(/export function deriveEventType\(inputs: EventTypeInputs\): \{[\s\S]*?^\} \{/m, "function deriveEventType(inputs) {");
}

// ── A LIFT THAT IS MISSING A CONSTANT MUST SAY SO, NOT THROW LATER ────────
//
// THREE TIMES NOW, in this repo, the same shape:
//
//   #474  scripts/annual-filer-census.mjs lifted populationQueues, which names
//         SEC_POPULATE_SLACK_CEILING in a DEFAULT PARAMETER. The lift compiled
//         and threw only when the function was CALLED — after four blocks of
//         correct-looking census output had already printed.
//   #472  needsReread gained SEC_LABEL_VERSION the same way and would have
//         been the next one.
//   #482  reaction-window-diagnosis lifted computeEarningsReactionDetail after
//         it gained REACTION_SESSION_GAP_DAYS. Same failure, same lateness:
//         the header, the bar counts and the window all printed first.
//
// WHY IT KEEPS HAPPENING. A lifted function's free variables are invisible at
// lift time: the module parses, imports fine, and holds a closure over a name
// that does not exist. Nothing is wrong until the call, and by then the script
// has produced output, so it reads as "the run stopped" rather than "a constant
// is missing". The ReferenceError names the SYMBOL and not the REASON, so the
// next person re-derives the reason from scratch.
//
// AND THE FIX KEEPS BEING AD HOC. Each site independently learned to read its
// constants from the source and inject them. The fourth site will not.
//
// So: `assertLiftIsClosed(src)` is run BEFORE the module is built, and reports
// EVERY missing name at once rather than the first one to be reached at
// runtime — which matters, because they are normally discovered one call at a
// time across several dispatches.
//
// ── CONSERVATIVE BY CONSTRUCTION ──────────────────────────────────────────
//
// Declarations are collected WITHOUT scope analysis: every binding name
// anywhere in the source counts as declared. That over-approximates, so a
// correctly-scoped program can never be flagged. What it still catches with
// certainty is a name that is declared NOWHERE — which is exactly the bug.
// A conservative check that never cries wolf is one people leave switched on.
import tsc from "typescript";

/** Names a lifted fragment may use without declaring. Not a style list. */
const AMBIENT = new Set([
  // ECMAScript
  "globalThis", "Object", "Array", "String", "Number", "Boolean", "Symbol",
  "BigInt", "Math", "JSON", "Date", "RegExp", "Error", "TypeError",
  "RangeError", "SyntaxError", "ReferenceError", "Map", "Set", "WeakMap",
  "WeakSet", "Promise", "Proxy", "Reflect", "Intl", "ArrayBuffer",
  "Uint8Array", "Int32Array", "Float64Array", "DataView", "Function",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
  "decodeURIComponent", "encodeURI", "decodeURI", "structuredClone",
  "undefined", "NaN", "Infinity", "arguments", "eval",
  // host
  "console", "process", "fetch", "Headers", "Request", "Response", "URL",
  "URLSearchParams", "TextEncoder", "TextDecoder", "AbortController",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask",
  "Buffer", "performance", "crypto", "atob", "btoa",
  // React, for the card lifts
  "React",
]);

/**
 * Every name the source BINDS, anywhere, at any depth.
 *
 * Deliberately flat. See the header: over-approximating declarations is what
 * makes a false positive impossible.
 */
function boundNames(sourceFile) {
  const out = new Set();
  const bind = (name) => {
    if (!name) return;
    if (tsc.isIdentifier(name)) out.add(name.text);
    else if (tsc.isObjectBindingPattern(name) || tsc.isArrayBindingPattern(name)) {
      for (const el of name.elements) if (!tsc.isOmittedExpression(el)) bind(el.name);
    }
  };
  const walk = (node) => {
    if (tsc.isVariableDeclaration(node) || tsc.isParameter(node) || tsc.isBindingElement(node)) bind(node.name);
    else if (tsc.isFunctionDeclaration(node) || tsc.isClassDeclaration(node) || tsc.isFunctionExpression(node)) {
      if (node.name) out.add(node.name.text);
    } else if (tsc.isImportSpecifier(node) || tsc.isImportClause(node) || tsc.isNamespaceImport(node)) {
      if (node.name) out.add(node.name.text);
    } else if (tsc.isCatchClause(node) && node.variableDeclaration) bind(node.variableDeclaration.name);
    tsc.forEachChild(node, walk);
  };
  walk(sourceFile);
  return out;
}

/**
 * Every name the source READS as a value.
 *
 * Property accesses, property names, labels and import/export specifiers are
 * skipped: `a.SEC_LABEL_VERSION` is not a reference to a free variable, and
 * counting it would flag every stored-set field.
 */
function readNames(sourceFile) {
  const out = new Set();
  const walk = (node) => {
    if (tsc.isIdentifier(node)) {
      const p = node.parent;
      const isProperty =
        p &&
        ((tsc.isPropertyAccessExpression(p) && p.name === node) ||
          (tsc.isPropertyAssignment(p) && p.name === node) ||
          (tsc.isPropertySignature(p) && p.name === node) ||
          (tsc.isMethodDeclaration(p) && p.name === node) ||
          (tsc.isBindingElement(p) && p.propertyName === node) ||
          tsc.isImportSpecifier(p) ||
          tsc.isExportSpecifier(p) ||
          tsc.isLabeledStatement(p) ||
          tsc.isBreakOrContinueStatement(p));
      if (!isProperty) out.add(node.text);
    }
    tsc.forEachChild(node, walk);
  };
  walk(sourceFile);
  return out;
}

/**
 * Throw unless every name the lifted source reads is one it can resolve.
 *
 * `label` names the lift in the message, because a check often builds several
 * and "which one" is the first thing anyone asks.
 */
export function assertLiftIsClosed(src, label = "lift") {
  const sf = tsc.createSourceFile("lift.ts", src, tsc.ScriptTarget.ES2020, true, tsc.ScriptKind.TS);
  const declared = boundNames(sf);
  const missing = [...readNames(sf)].filter((n) => !declared.has(n) && !AMBIENT.has(n)).sort();
  if (missing.length) {
    throw new Error(
      `${label}: ${missing.length} name(s) are read but never declared — ` +
        `${missing.join(", ")}.\n` +
        `  A lifted function closes over these and will throw ReferenceError on ` +
        `its first CALL, after the script has already printed output.\n` +
        `  Read each from the source and prepend it to the lift (never pin a ` +
        `literal — see scripts/lib/source-code.mjs for why this check exists).`
    );
  }
  return src;
}
