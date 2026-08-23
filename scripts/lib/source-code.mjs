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
export function readCodeOnly(relPath, opts = {}) {
  const full = path.join(process.cwd(), relPath);
  return stripComments(fs.readFileSync(full, "utf8"), { file: relPath, ...opts });
}
