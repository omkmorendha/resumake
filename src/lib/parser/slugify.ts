/**
 * Slug generation for stable section identifiers.
 *
 * WHY: Feedback points anchor to a section by a *stable* `sectionId` (plus
 * quoted text), not by char offsets — offsets drift after every edit. The
 * id therefore has to be deterministic and reproducible from the section
 * title alone, so that re-parsing the (possibly edited) document re-derives
 * the same id and feedback re-resolves to the right section.
 */

/**
 * Turn an arbitrary heading title into a URL/identifier-safe slug.
 *
 * Rules (per spec §8 conventions):
 * - lowercase
 * - any run of non-alphanumeric characters (spaces, punctuation, LaTeX
 *   escapes, accents stripped to nothing) collapses to a single hyphen
 * - leading/trailing hyphens trimmed
 * - repeated hyphens collapsed
 *
 * A title that contains no alphanumerics at all (e.g. only LaTeX commands or
 * punctuation) yields an empty string; callers are responsible for supplying a
 * fallback id in that case (see {@link uniqueSlug}). We deliberately do NOT
 * throw — the parser must never throw on hostile input.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD") // split accented chars so the diacritics drop below
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/[^a-z0-9]+/g, "-") // any non-alphanumeric run -> single hyphen
    .replace(/-+/g, "-") // collapse repeats (defensive; regex above already does)
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens
}

/**
 * Produce a slug that is unique within a parse, deduping collisions
 * deterministically.
 *
 * WHY deterministic: two sections legitimately can share a title (e.g. two
 * `\section{Projects}` blocks, or a resume class that repeats "Experience").
 * Re-parsing must assign the same ids in the same order every time, otherwise
 * anchors silently re-bind to the wrong block. We therefore suffix collisions
 * by ascending integer in document order: `projects`, `projects-2`,
 * `projects-3`, ...
 *
 * @param base   The desired slug (already passed through {@link slugify}, or
 *               raw — we re-slugify defensively).
 * @param taken  A set of slugs already assigned in this parse. MUTATED: the
 *               returned slug is added to it.
 * @param fallback Used when `base` slugifies to the empty string (title was
 *               all punctuation/commands). Defaults to `"section"`.
 */
export function uniqueSlug(
  base: string,
  taken: Set<string>,
  fallback = "section",
): string {
  const slug = slugify(base) || fallback;
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  // Deterministic numeric suffix. Start at 2 so the human-facing sequence reads
  // experience, experience-2, experience-3 (the first occurrence keeps the bare
  // slug).
  let n = 2;
  let candidate = `${slug}-${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${slug}-${n}`;
  }
  taken.add(candidate);
  return candidate;
}
