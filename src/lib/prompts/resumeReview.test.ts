/**
 * Review-prompt tests (Task 3.2): the JD branch injects requirements into the
 * RELEVANCE dimension and asks for gap points; the non-JD branch does not.
 */
import { describe, expect, it } from "vitest";

import type { JobRequirements } from "@/lib/llm";
import type { ParsedSection } from "@/lib/parser";
import {
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
} from "./resumeReview";

const SECTIONS: ParsedSection[] = [
  { sectionId: "experience", title: "Experience", level: 1, texRange: { start: 0, end: 10 }, subBlocks: [] },
  { sectionId: "skills", title: "Skills", level: 1, texRange: { start: 10, end: 20 }, subBlocks: [] },
];

const JD: JobRequirements = {
  mustHaveSkills: ["Kubernetes", "Go"],
  niceToHaveSkills: ["Terraform"],
  keywords: ["kubernetes", "golang", "ci/cd"],
  responsibilities: ["Operate production clusters"],
  rawText: "We need a platform engineer...",
};

describe("buildReviewSystemPrompt", () => {
  it("asks for gap points and references the JD when one is present", () => {
    const sys = buildReviewSystemPrompt(JD);
    expect(sys).toMatch(/must-have skills and ATS keywords/i);
    expect(sys).toMatch(/gap points/i);
    expect(sys).toMatch(/why it matters for the target role/i);
  });

  it("uses the apparent-role wording without a JD", () => {
    const sys = buildReviewSystemPrompt(undefined);
    expect(sys).toMatch(/apparent target role/i);
    expect(sys).not.toMatch(/gap points/i);
  });
});

describe("buildReviewUserPrompt", () => {
  it("embeds the JD requirements so the model can find keyword/skill gaps", () => {
    const user = buildReviewUserPrompt({
      resumeTex: "\\section{Experience}...",
      sections: SECTIONS,
      jobRequirements: JD,
    });
    expect(user).toMatch(/TARGET JOB REQUIREMENTS/);
    expect(user).toContain("Kubernetes");
    expect(user).toContain("kubernetes, golang, ci/cd");
    // section ids are offered for anchoring
    expect(user).toContain("experience");
    expect(user).toContain("skills");
  });

  it("omits the JD block when no JD is provided", () => {
    const user = buildReviewUserPrompt({
      resumeTex: "x",
      sections: SECTIONS,
    });
    expect(user).not.toMatch(/TARGET JOB REQUIREMENTS/);
  });
});
