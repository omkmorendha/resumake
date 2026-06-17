/**
 * Job-description extraction prompt (spec §9, design.html §7). Parses pasted JD
 * text into a structured JobRequirements (must/nice skills, years, top 10–15
 * keywords, responsibilities). No invented requirements — only what's in the
 * text. The model returns JSON matching JobRequirementsSchema; the app stores
 * it as jobposting.json and feeds it into the RELEVANCE review dimension (M3).
 */

export const JD_EXTRACTION_SYSTEM = `You extract structured hiring requirements from a job posting. You report
ONLY what is present in the text — never infer or invent requirements that
are not stated. Be precise and conservative.`;

export function buildJdExtractionUser(rawText: string): string {
  return [
    "Extract structured requirements from this job posting:",
    "- must-have skills (explicitly required)",
    "- nice-to-have skills (preferred / a plus)",
    "- years of experience (as a string, e.g. \"5+ years\"; omit if not stated)",
    "- the top 10–15 ATS keywords (specific technologies, methodologies, role terms)",
    "- key responsibilities",
    "Do not infer requirements not present in the text.",
    "",
    "JOB POSTING:",
    "```",
    rawText,
    "```",
    "",
    "Respond with ONLY a JSON object of this exact shape (no prose, no code fences):",
    "{",
    '  "mustHaveSkills": string[],',
    '  "niceToHaveSkills": string[],',
    '  "yearsExperience": string (optional),',
    '  "keywords": string[],',
    '  "responsibilities": string[],',
    '  "rawText": string (echo the posting text back verbatim)',
    "}",
  ].join("\n");
}
