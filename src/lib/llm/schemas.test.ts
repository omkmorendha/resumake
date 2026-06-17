/**
 * Schema validation tests (Task 2.1 AC): each schema validates a sample
 * payload and rejects malformed input.
 */
import { describe, expect, it } from "vitest";

import {
  CategorySchema,
  ChatMessageSchema,
  FeedbackPointSchema,
  JobRequirementsSchema,
  ResumeSegmentationSchema,
  ReviewResultSchema,
  SectionAnchorSchema,
  SeveritySchema,
} from "./schemas";

describe("SeveritySchema / CategorySchema", () => {
  it("accepts valid enum members", () => {
    expect(SeveritySchema.parse("critical")).toBe("critical");
    expect(CategorySchema.parse("ats")).toBe("ats");
  });
  it("rejects unknown members", () => {
    expect(SeveritySchema.safeParse("blocker").success).toBe(false);
    expect(CategorySchema.safeParse("vibes").success).toBe(false);
  });
});

describe("SectionAnchorSchema", () => {
  it("accepts a minimal anchor and an anchor with texRange", () => {
    expect(
      SectionAnchorSchema.parse({ sectionId: "experience", sectionTitle: "Experience" }),
    ).toMatchObject({ sectionId: "experience" });
    expect(
      SectionAnchorSchema.parse({
        sectionId: "skills",
        sectionTitle: "Skills",
        texRange: { start: 10, end: 40 },
      }),
    ).toMatchObject({ texRange: { start: 10, end: 40 } });
  });
  it("rejects a missing sectionId", () => {
    expect(SectionAnchorSchema.safeParse({ sectionTitle: "X" }).success).toBe(false);
  });
});

describe("FeedbackPointSchema", () => {
  const valid = {
    id: "fp_1",
    category: "impact",
    severity: "high",
    anchor: { sectionId: "experience", sectionTitle: "Experience" },
    issue: "Bullet lacks a measurable outcome.",
    suggestion: "Quantify the result (e.g. cut latency 40%).",
    status: "open",
  };

  it("accepts a valid point", () => {
    expect(FeedbackPointSchema.parse(valid)).toMatchObject({ id: "fp_1" });
  });
  it("rejects an invalid category", () => {
    expect(
      FeedbackPointSchema.safeParse({ ...valid, category: "nonsense" }).success,
    ).toBe(false);
  });
  it("rejects a missing anchor", () => {
    const { anchor: _omit, ...withoutAnchor } = valid;
    void _omit;
    expect(FeedbackPointSchema.safeParse(withoutAnchor).success).toBe(false);
  });
});

describe("ReviewResultSchema (LLM review output)", () => {
  it("accepts drafts without id/status", () => {
    const parsed = ReviewResultSchema.parse({
      points: [
        {
          category: "ats",
          severity: "medium",
          anchor: { sectionId: "skills", sectionTitle: "Skills" },
          issue: "Skills as a table may not parse in ATS.",
          suggestion: "Use a comma-separated list.",
        },
      ],
    });
    expect(parsed.points).toHaveLength(1);
  });
  it("rejects a draft that smuggles an unknown severity", () => {
    expect(
      ReviewResultSchema.safeParse({
        points: [
          {
            category: "ats",
            severity: "kinda-bad",
            anchor: { sectionId: "s", sectionTitle: "S" },
            issue: "x",
            suggestion: "y",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("ChatMessageSchema", () => {
  it("accepts a message with a proposed edit", () => {
    expect(
      ChatMessageSchema.parse({
        id: "m1",
        role: "assistant",
        content: "Here's a tighter bullet.",
        ts: "2026-06-17T00:00:00.000Z",
        proposedEdit: { diff: "- old\n+ new", targetSectionId: "experience" },
      }),
    ).toMatchObject({ role: "assistant" });
  });
  it("rejects an unknown role", () => {
    expect(
      ChatMessageSchema.safeParse({ id: "m", role: "system", content: "", ts: "" })
        .success,
    ).toBe(false);
  });
});

describe("JobRequirementsSchema", () => {
  it("accepts full requirements", () => {
    expect(
      JobRequirementsSchema.parse({
        mustHaveSkills: ["TypeScript"],
        niceToHaveSkills: ["Rust"],
        keywords: ["react", "node"],
        responsibilities: ["Build features"],
        rawText: "We need a TS dev...",
      }).mustHaveSkills,
    ).toEqual(["TypeScript"]);
  });
  it("rejects when arrays are the wrong type", () => {
    expect(
      JobRequirementsSchema.safeParse({
        mustHaveSkills: "TypeScript",
        niceToHaveSkills: [],
        keywords: [],
        responsibilities: [],
        rawText: "",
      }).success,
    ).toBe(false);
  });
});

describe("ResumeSegmentationSchema", () => {
  it("accepts a minimal valid segmentation", () => {
    expect(
      ResumeSegmentationSchema.parse({
        contact: { name: "Ada", email: "ada@x.com", links: [] },
        experience: [],
        education: [],
        skills: [],
      }),
    ).toMatchObject({ contact: { name: "Ada" } });
  });
  it("rejects a missing contact", () => {
    expect(
      ResumeSegmentationSchema.safeParse({
        experience: [],
        education: [],
        skills: [],
      }).success,
    ).toBe(false);
  });
});
