/**
 * Resume-review prompt (spec §9, design.html §7). Expert-reviewer + ATS-aware,
 * scored across impact/clarity/ats/relevance/formatting/consistency/grammar.
 * Each issue becomes a structured FeedbackPointDraft anchored to quoted source
 * text. The model returns a ReviewResult ({ points: [...] }); the app assigns
 * id + status afterward.
 *
 * JD-aware analysis (M3) injects JobRequirements into the RELEVANCE dimension
 * and asks for gap points; that branch is wired here behind `jobRequirements`
 * so M3 only has to pass the data.
 */
import type { ParsedSection } from "@/lib/parser";
import type { JobRequirements } from "@/lib/llm";

const SYSTEM_BASE = `You are an expert technical resume reviewer and career coach who also
understands how Applicant Tracking Systems (ATS) parse resumes. You give
specific, actionable, honest feedback — never vague praise.

Evaluate the resume across these dimensions:
1. IMPACT     — Does each bullet show a quantified result? Strong action
                verb first? STAR-shaped (Situation/Task/Action/Result)?
2. CLARITY    — Concise, jargon-appropriate, no filler ("responsible for").
3. ATS        — One-column, no tables/text-boxes/graphics that break parsers;
                standard section headings; parseable dates.
4. RELEVANCE  — {RELEVANCE_CLAUSE}
5. FORMATTING — Consistency (tense, punctuation, date format), length
                (prefer one page), whitespace.
6. CONSISTENCY/GRAMMAR — tense agreement, typos, parallel structure.

For EACH issue, emit a structured feedback point with:
- category, severity, the section it targets,
- a precise description of the issue,
- a concrete suggestion (rewrite weak bullets verbatim where useful),
- {JD_CLAUSE}

Prefer fewer, higher-signal points over exhaustive nitpicks. Order by
severity. Quote the exact resume text you are critiquing so it can be
anchored to the source. Do NOT invent achievements or fabricate metrics —
flag missing metrics and ask the user to supply them.`;

const OUTPUT_CONTRACT = `Respond with ONLY a JSON object of this exact shape (no prose, no code fences):
{
  "points": [
    {
      "category": "impact" | "clarity" | "ats" | "formatting" | "relevance" | "consistency" | "grammar",
      "severity": "critical" | "high" | "medium" | "low" | "nit",
      "anchor": { "sectionId": "<one of the section ids listed below>", "sectionTitle": "<its title>" },
      "issue": "<what is wrong, quoting the exact resume text>",
      "suggestion": "<concrete fix>",
      "jdRelevance": "<optional: why it matters for the target role>"
    }
  ]
}
Use a sectionId from the provided section list. If an issue is document-wide, use the first listed section.`;

export interface ReviewPromptArgs {
  resumeTex: string;
  sections: ParsedSection[];
  jobRequirements?: JobRequirements;
}

export function buildReviewSystemPrompt(jobRequirements?: JobRequirements): string {
  const relevanceClause = jobRequirements
    ? "alignment to the target role's must-have skills and ATS keywords below; surface missing must-haves/keywords as high-severity relevance gap points."
    : "alignment to the apparent target role implied by the resume.";
  const jdClause = jobRequirements
    ? "why it matters for the target role."
    : "(omit role-specific rationale; no job description was provided).";
  return SYSTEM_BASE.replace("{RELEVANCE_CLAUSE}", relevanceClause).replace(
    "{JD_CLAUSE}",
    jdClause,
  );
}

export function buildReviewUserPrompt(args: ReviewPromptArgs): string {
  const sectionList = args.sections
    .map((s) => `- ${s.sectionId} ("${s.title}")`)
    .join("\n");

  const jdBlock = args.jobRequirements
    ? [
        "",
        "TARGET JOB REQUIREMENTS:",
        `Must-have skills: ${args.jobRequirements.mustHaveSkills.join(", ") || "(none listed)"}`,
        `Nice-to-have skills: ${args.jobRequirements.niceToHaveSkills.join(", ") || "(none listed)"}`,
        `Keywords: ${args.jobRequirements.keywords.join(", ") || "(none listed)"}`,
        `Responsibilities: ${args.jobRequirements.responsibilities.join("; ") || "(none listed)"}`,
      ].join("\n")
    : "";

  return [
    "Review this LaTeX resume. The detected sections (use these sectionIds) are:",
    sectionList || "- document (\"Document\")",
    jdBlock,
    "",
    "RESUME SOURCE (LaTeX):",
    "```latex",
    args.resumeTex,
    "```",
    "",
    OUTPUT_CONTRACT,
  ].join("\n");
}
