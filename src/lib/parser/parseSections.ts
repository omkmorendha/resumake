/**
 * Heuristic LaTeX resume section parser.
 *
 * WHY a heuristic (not a real LaTeX parse): resume templates in the wild use
 * wildly different document classes (moderncv, Jake's res template, custom
 * `rSection` environments, exotic one-offs). A full LaTeX parser would be huge,
 * fragile, and still wrong for custom macros. We only need a *section tree* good
 * enough to anchor feedback, so we scan line-by-line for a small set of
 * recognized heading constructs and treat everything between two headings as one
 * section's body.
 *
 * Contract (spec §8, design.html §8):
 *  - Detect `\section{...}`, `\subsection{...}`, common resume macros, and
 *    section-like environments (`\begin{rSection}{Title}`).
 *  - Each heading becomes a {@link ParsedSection} with a stable `sectionId`
 *    (slug of the title) and an INFORMATIONAL `texRange` to the next heading.
 *  - `\item` bullets inside a section are captured as candidate sub-blocks.
 *  - NO headings found  -> a single synthetic `document` section (whole body).
 *  - `\subsubsection` and deeper are FLATTENED into the nearest section/
 *    subsection: they never create a top-level section; they are recorded as
 *    `subBlock` labels only.
 *  - The parser MUST NEVER throw. Any unrecognized / malformed input degrades to
 *    whole-document anchoring.
 *
 * Anchors are designed to re-resolve by `sectionId` + quoted text after edits
 * (char offsets drift), so we keep titles and bullet text, not just offsets.
 */

import { slugify, uniqueSlug } from "./slugify";

/** The kind of sub-block captured inside a section. */
export type SubBlockKind =
  | "bullet" // an \item
  | "subheading" // a resume macro entry (\resumeSubheading, \cventry, ...)
  | "subsubsection"; // a flattened \subsubsection (or deeper)

/**
 * A sub-block inside a section: a bullet, a macro-driven subheading, or a
 * flattened deep heading. `text` is the human-readable label we anchor against;
 * `texRange` is informational only.
 */
export interface SubBlock {
  kind: SubBlockKind;
  /** Human-readable label (bullet text, entry title, or flattened heading title). */
  text: string;
  /** Informational char range within the original `tex`. */
  texRange: { start: number; end: number };
}

/**
 * A parsed section of the resume. Richer than {@link SectionAnchor} (which is the
 * persisted/feedback-facing shape) — convert with {@link toSectionAnchor}.
 */
export interface ParsedSection {
  /** Stable, slugified, collision-deduped id (e.g. "experience", "experience-2"). */
  sectionId: string;
  /** Original heading title as written (e.g. "Experience"). */
  title: string;
  /**
   * Heading depth used for anchoring: 1 = `\section`/env/top-level macro,
   * 2 = `\subsection`. `\subsubsection`+ never appear here (flattened into the
   * nearest section as a sub-block).
   */
  level: 1 | 2;
  /**
   * INFORMATIONAL char range [start, end) running from this heading to the next
   * heading (or end of document). Used for editor highlighting only — feedback
   * anchoring re-resolves by `sectionId` + quoted text because offsets drift.
   */
  texRange: { start: number; end: number };
  /** Bullets / macro subheadings / flattened deep headings inside this section. */
  subBlocks: SubBlock[];
  /**
   * True for the synthetic whole-document section produced when no headings are
   * recognized. Lets callers fall back to quoted-text-only anchoring.
   */
  synthetic?: boolean;
}

/**
 * The persisted, feedback-facing anchor shape (spec §5). A {@link ParsedSection}
 * is convertible to this with {@link toSectionAnchor}.
 */
export interface SectionAnchor {
  sectionId: string;
  sectionTitle: string;
  subBlock?: string;
  /** Informational char range. */
  texRange?: { start: number; end: number };
}

/**
 * Common resume "entry" macros that introduce a subheading block (a job, a
 * project, a degree) inside a `\section`. These do NOT start a new section —
 * they are recorded as `subheading` sub-blocks of the current section. WHY: in
 * templates like "Jake's Resume" the real sections come from `\section{...}`
 * and these macros are the entries within them.
 *
 * Matched case-sensitively against the command name after the leading backslash.
 */
const SUBHEADING_MACROS = new Set<string>([
  "resumeSubheading",
  "resumeProjectHeading",
  "resumeSubSubheading",
  "cventry",
  "cvitem",
  "cvlistitem",
  "cvlistdoubleitem",
  "resumeItem", // some templates use this for entries; harmless as a subheading
  "datedsubsection",
  "entry",
  "twocolentry",
  "onecolentry",
]);

/**
 * Section-like environments whose FIRST `{...}` argument is the section title.
 * e.g. `\begin{rSection}{Skills}` (the popular "sb2nov" / rSection class).
 */
const SECTION_ENVIRONMENTS = new Set<string>(["rSection"]);

/**
 * Extract the first brace-delimited argument starting at `from` (the index of
 * the opening `{`), respecting nested braces. Returns the inner content and the
 * index just past the closing `}`, or `null` if unbalanced/missing.
 *
 * WHY balance-aware: titles can contain nested braces (`\textbf{X}`), and a
 * naive `{([^}]*)}` would truncate them. We never throw on unbalanced input —
 * we return null and the caller skips the construct.
 */
function readBraceArg(
  src: string,
  from: number,
): { content: string; end: number } | null {
  if (src[from] !== "{") return null;
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { content: src.slice(from + 1, i), end: i + 1 };
      }
    }
  }
  return null; // unbalanced — degrade gracefully
}

/**
 * Strip a handful of common LaTeX formatting commands from a title/label so the
 * slug and display text are clean (e.g. `\textbf{Experience}` -> `Experience`).
 * This is intentionally shallow: we only want readable anchors, not a full
 * de-TeX. Never throws.
 */
function cleanLabel(raw: string): string {
  return raw
    .replace(/\\[a-zA-Z]+\*?\s*/g, "") // drop \command (and starred) names
    .replace(/[{}]/g, "") // drop stray braces
    .replace(/\\[%&_#$]/g, (m) => m.slice(1)) // unescape \%, \&, etc.
    .replace(/~/g, " ") // non-breaking space -> space
    .replace(/\s+/g, " ")
    .trim();
}

/** Recognized heading constructs, scanned line by line. */
type HeadingHit =
  | {
      type: "section";
      level: 1 | 2;
      title: string;
      /** Char offset where this heading begins. */
      start: number;
    }
  | {
      type: "deep-heading"; // \subsubsection or deeper -> flatten
      title: string;
      start: number;
    };

/**
 * Detect a sectioning command (`\section`, `\subsection`, `\subsubsection`,
 * `\paragraph`, ...) at offset `idx` and classify it. Returns the heading hit
 * plus the offset past its title argument, or `null` if it is not a sectioning
 * command. Starred forms (`\section*{...}`) are supported.
 */
function matchSectionCommand(
  src: string,
  idx: number,
): { hit: HeadingHit; next: number } | null {
  // src[idx] is known to be '\'. Read the command name.
  const m = /^\\(sub)*section\*?/.exec(src.slice(idx));
  if (!m) return null;
  const matched = m[0];
  // Count the depth: \section = 1, \subsection = 2, \subsubsection = 3, ...
  const subCount = (matched.match(/sub/g) ?? []).length;
  const level = subCount + 1; // 1-based section depth

  // Find the title arg — allow optional [..] (e.g. \section[short]{long}) and
  // whitespace before the brace.
  let cursor = idx + matched.length;
  // skip optional \section[..]
  while (cursor < src.length && /\s/.test(src[cursor] ?? "")) cursor += 1;
  if (src[cursor] === "[") {
    const optEnd = src.indexOf("]", cursor);
    if (optEnd !== -1) cursor = optEnd + 1;
  }
  while (cursor < src.length && /\s/.test(src[cursor] ?? "")) cursor += 1;

  const arg = readBraceArg(src, cursor);
  const title = arg ? cleanLabel(arg.content) : "";
  const next = arg ? arg.end : cursor;

  if (level >= 3) {
    return { hit: { type: "deep-heading", title, start: idx }, next };
  }
  return {
    hit: { type: "section", level: level as 1 | 2, title, start: idx },
    next,
  };
}

/**
 * Detect `\begin{<env>}{Title}` for a section-like environment at offset `idx`.
 * Returns the heading hit + offset past the title arg, or `null`.
 */
function matchSectionEnvironment(
  src: string,
  idx: number,
): { hit: HeadingHit; next: number } | null {
  const m = /^\\begin\s*\{([a-zA-Z*]+)\}/.exec(src.slice(idx));
  if (!m) return null;
  const env = m[1] ?? "";
  if (!SECTION_ENVIRONMENTS.has(env)) return null;
  let cursor = idx + m[0].length;
  while (cursor < src.length && /\s/.test(src[cursor] ?? "")) cursor += 1;
  const arg = readBraceArg(src, cursor);
  const title = arg ? cleanLabel(arg.content) : env;
  const next = arg ? arg.end : cursor;
  return {
    hit: { type: "section", level: 1, title, start: idx },
    next,
  };
}

/** A recognized sub-block construct (bullet or macro subheading). */
type SubBlockHit = {
  kind: "bullet" | "subheading";
  text: string;
  start: number;
  next: number;
};

/**
 * Detect an `\item` bullet at offset `idx`. The bullet text runs to the end of
 * the line (good enough for an anchor label). Returns null if not an `\item`.
 */
function matchItem(src: string, idx: number): SubBlockHit | null {
  const m = /^\\item\b\s*(\[[^\]]*\]\s*)?/.exec(src.slice(idx));
  if (!m) return null;
  const textStart = idx + m[0].length;
  let lineEnd = src.indexOf("\n", textStart);
  if (lineEnd === -1) lineEnd = src.length;
  const text = cleanLabel(src.slice(textStart, lineEnd));
  return { kind: "bullet", text, start: idx, next: lineEnd };
}

/**
 * Detect a resume subheading macro (`\resumeSubheading{..}`, `\cventry{..}`,
 * ...) at offset `idx`. We use the FIRST brace argument as the label (job/
 * project/degree name). Returns null if not a known macro.
 */
function matchSubheadingMacro(src: string, idx: number): SubBlockHit | null {
  const m = /^\\([a-zA-Z]+)/.exec(src.slice(idx));
  if (!m) return null;
  const name = m[1] ?? "";
  if (!SUBHEADING_MACROS.has(name)) return null;
  let cursor = idx + m[0].length;
  while (cursor < src.length && /\s/.test(src[cursor] ?? "")) cursor += 1;
  // Some macros (cventry) start with positional args; take the first non-empty
  // brace arg as the label.
  let label = name;
  let next = cursor;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    while (next < src.length && /\s/.test(src[next] ?? "")) next += 1;
    const arg = readBraceArg(src, next);
    if (!arg) break;
    next = arg.end;
    const cleaned = cleanLabel(arg.content);
    if (cleaned) {
      label = cleaned;
      break;
    }
  }
  return { kind: "subheading", text: label, start: idx, next };
}

/**
 * Parse `tex` into a flat list of {@link ParsedSection}s in document order.
 *
 * Never throws. On input with no recognized headings (empty string, whitespace,
 * or an exotic class), returns a single synthetic `document` section spanning the
 * whole input — see the fallback in spec §8.
 */
export function parseSections(tex: string): ParsedSection[] {
  // Guard: non-string / nullish input degrades to an empty-document fallback
  // rather than throwing (the parser must never throw).
  const src = typeof tex === "string" ? tex : "";

  const taken = new Set<string>();
  const sections: ParsedSection[] = [];

  // Pass 1: collect headings + the sub-block hits, scanning char by char so we
  // can respect brace nesting in arguments. We only inspect positions that begin
  // a command (`\`) for the command-based constructs.
  type Pending = {
    hit: HeadingHit;
  };
  const headings: Pending[] = [];
  // Sub-block hits keyed by their start offset; assigned to a section in pass 2.
  const subHits: SubBlockHit[] = [];

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch !== "\\") {
      i += 1;
      continue;
    }

    // Try the constructs in priority order. Environment + section commands are
    // headings; item + macros are sub-blocks.
    const env = matchSectionEnvironment(src, i);
    if (env) {
      headings.push({ hit: env.hit });
      i = env.next;
      continue;
    }
    const sec = matchSectionCommand(src, i);
    if (sec) {
      headings.push({ hit: sec.hit });
      i = sec.next;
      continue;
    }
    const item = matchItem(src, i);
    if (item) {
      subHits.push(item);
      i = item.next;
      continue;
    }
    const macro = matchSubheadingMacro(src, i);
    if (macro) {
      subHits.push(macro);
      i = macro.next;
      continue;
    }

    // Unknown command: skip the backslash and continue.
    i += 1;
  }

  // Keep only real (non-deep) section headings as section boundaries. Deep
  // headings (\subsubsection+) are flattened into the nearest preceding section
  // as sub-blocks.
  const sectionHeadings = headings.filter((h) => h.hit.type === "section");

  // FALLBACK: no recognized headings -> one synthetic `document` section.
  if (sectionHeadings.length === 0) {
    const doc: ParsedSection = {
      sectionId: "document",
      title: "Document",
      level: 1,
      texRange: { start: 0, end: src.length },
      subBlocks: subHits.map((s) => ({
        kind: s.kind,
        text: s.text,
        texRange: { start: s.start, end: s.next },
      })),
      synthetic: true,
    };
    return [doc];
  }

  // Pass 2: build sections with [start, end) ranges to the next section heading.
  for (let s = 0; s < sectionHeadings.length; s += 1) {
    const cur = sectionHeadings[s]!;
    const hit = cur.hit;
    // (filter above guarantees type === "section", but narrow for TS)
    if (hit.type !== "section") continue;
    const nextHeading = sectionHeadings[s + 1];
    const start = hit.start;
    const end =
      nextHeading && nextHeading.hit.type === "section"
        ? nextHeading.hit.start
        : src.length;

    const section: ParsedSection = {
      sectionId: uniqueSlug(hit.title, taken),
      title: hit.title || "Section",
      level: hit.level,
      texRange: { start, end },
      subBlocks: [],
      synthetic: false,
    };
    sections.push(section);
  }

  // Assign sub-block hits (bullets + macros) to the section whose range
  // contains them.
  const assignToSection = (start: number): ParsedSection | undefined => {
    // Sections are in document order with contiguous ranges; linear scan is
    // fine (resumes are small) and avoids edge cases.
    for (const sec of sections) {
      if (start >= sec.texRange.start && start < sec.texRange.end) return sec;
    }
    return undefined;
  };

  for (const s of subHits) {
    const owner = assignToSection(s.start);
    if (!owner) continue; // sub-block before the first heading (preamble) — drop
    owner.subBlocks.push({
      kind: s.kind,
      text: s.text,
      texRange: { start: s.start, end: s.next },
    });
  }

  // Flatten deep headings (\subsubsection+) into the nearest preceding section
  // as `subsubsection` sub-blocks. They are recorded as labels only and never
  // create a top-level section (spec §8 nesting flatten).
  for (const h of headings) {
    if (h.hit.type !== "deep-heading") continue;
    const owner = assignToSection(h.hit.start);
    if (!owner) continue;
    owner.subBlocks.push({
      kind: "subsubsection",
      text: h.hit.title || "Detail",
      texRange: { start: h.hit.start, end: h.hit.start },
    });
  }

  // Re-sort each section's sub-blocks by document order (deep headings were
  // appended after the bullet/macro pass).
  for (const sec of sections) {
    sec.subBlocks.sort((a, b) => a.texRange.start - b.texRange.start);
  }

  return sections;
}

/**
 * Convert a {@link ParsedSection} to the persisted {@link SectionAnchor} shape.
 *
 * @param section  The parsed section.
 * @param subBlock Optional sub-block label to anchor to a specific bullet/entry
 *                 within the section.
 */
export function toSectionAnchor(
  section: ParsedSection,
  subBlock?: string,
): SectionAnchor {
  return {
    sectionId: section.sectionId,
    sectionTitle: section.title,
    ...(subBlock !== undefined ? { subBlock } : {}),
    texRange: { ...section.texRange },
  };
}

// Re-export slug helpers so callers can derive ids consistently.
export { slugify, uniqueSlug };
