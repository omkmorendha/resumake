/**
 * Public API of the heuristic resume section parser.
 *
 * Consumers should import from `@/lib/parser` rather than reaching into
 * individual files, so the internal layout can change without churn.
 */

export {
  parseSections,
  toSectionAnchor,
  slugify,
  uniqueSlug,
} from "./parseSections";

export type {
  ParsedSection,
  SubBlock,
  SubBlockKind,
  SectionAnchor,
} from "./parseSections";
