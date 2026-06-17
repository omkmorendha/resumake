import { describe, it, expect } from "vitest";

import { slugify, uniqueSlug } from "./slugify";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Work Experience")).toBe("work-experience");
  });

  it("collapses runs of punctuation/whitespace to a single hyphen", () => {
    expect(slugify("Skills   &   Tools!!!")).toBe("skills-tools");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  --Education--  ")).toBe("education");
  });

  it("strips accents/diacritics down to ASCII", () => {
    expect(slugify("Résumé Café")).toBe("resume-cafe");
  });

  it("returns empty string for all-punctuation input (caller supplies fallback)", () => {
    expect(slugify("\\&%{}")).toBe("");
  });
});

describe("uniqueSlug", () => {
  it("returns the bare slug for the first occurrence", () => {
    const taken = new Set<string>();
    expect(uniqueSlug("Experience", taken)).toBe("experience");
  });

  it("dedupes collisions deterministically with ascending suffixes", () => {
    const taken = new Set<string>();
    expect(uniqueSlug("Experience", taken)).toBe("experience");
    expect(uniqueSlug("Experience", taken)).toBe("experience-2");
    expect(uniqueSlug("Experience", taken)).toBe("experience-3");
  });

  it("uses the fallback when the base slugifies to empty", () => {
    const taken = new Set<string>();
    expect(uniqueSlug("{}", taken)).toBe("section");
    expect(uniqueSlug("%%", taken)).toBe("section-2");
  });
});
