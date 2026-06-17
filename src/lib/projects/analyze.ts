/**
 * Run resume analysis (Task 2.5): parse the resume into sections, prompt the
 * chosen provider for a structured ReviewResult, attach app-assigned id +
 * status to each point, persist feedback.json, and return the FeedbackPoint[].
 *
 * The provider is injected so the route picks Claude or OpenAI and tests pass a
 * fake. Points are sorted by severity (critical → nit) so the UI's default
 * order matches the prompt's instruction.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseSections } from "@/lib/parser";
import {
  ReviewResultSchema,
  type FeedbackPoint,
  type JobRequirements,
  type LLMProvider,
} from "@/lib/llm";
import {
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
} from "@/lib/prompts/resumeReview";
import { PROJECT_FILENAMES, atomicWriteJson, getProjectDir } from "@/lib/storage";
import { getDataRoot } from "@/lib/storage";

import { readJobRequirements } from "./jobPosting";

const SEVERITY_ORDER: Record<FeedbackPoint["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  nit: 4,
};

export function sortBySeverity(points: FeedbackPoint[]): FeedbackPoint[] {
  return [...points].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

export interface AnalyzeInput {
  projectId: string;
  provider: LLMProvider;
  /**
   * JD requirements for JD-aware analysis. If omitted, stored requirements are
   * loaded from jobposting.json when present (Task 3.2). Pass `null` to force a
   * non-JD analysis even when a JD is stored.
   */
  jobRequirements?: JobRequirements | null;
  dataRoot?: string;
  /** Inject the resume source (tests); otherwise read from disk. */
  resumeTex?: string;
}

export async function analyzeResume(
  input: AnalyzeInput,
): Promise<FeedbackPoint[]> {
  const dataRoot = input.dataRoot ?? getDataRoot();
  const dir = getProjectDir(input.projectId, dataRoot);

  const resumeTex =
    input.resumeTex ??
    (await readFile(join(dir, PROJECT_FILENAMES.resumeTex), "utf8"));

  const sections = parseSections(resumeTex);

  // Use the explicitly-passed JD, else auto-load a stored one (undefined → load;
  // null → caller forced a non-JD analysis).
  const jobRequirements =
    input.jobRequirements === undefined
      ? await readJobRequirements(input.projectId, dataRoot)
      : input.jobRequirements;
  const jd = jobRequirements ?? undefined;

  const review = await input.provider.generateStructured({
    system: buildReviewSystemPrompt(jd),
    user: buildReviewUserPrompt({
      resumeTex,
      sections,
      jobRequirements: jd,
    }),
    schema: ReviewResultSchema,
  });

  // Attach app-assigned id + status; default any unknown sectionId to the first
  // parsed section (or a synthetic document anchor) so the UI always resolves.
  const fallbackSectionId = sections[0]?.sectionId ?? "document";
  const fallbackTitle = sections[0]?.title ?? "Document";

  const points: FeedbackPoint[] = review.points.map((draft) => {
    const known = sections.some((s) => s.sectionId === draft.anchor.sectionId);
    return {
      ...draft,
      id: `fp_${randomUUID()}`,
      status: "open",
      anchor: known
        ? draft.anchor
        : { sectionId: fallbackSectionId, sectionTitle: fallbackTitle },
    };
  });

  const sorted = sortBySeverity(points);
  await atomicWriteJson(join(dir, PROJECT_FILENAMES.feedback), sorted);
  return sorted;
}

/** Read persisted feedback.json (empty array if none). */
export async function readFeedback(
  projectId: string,
  dataRoot: string = getDataRoot(),
): Promise<FeedbackPoint[]> {
  const dir = getProjectDir(projectId, dataRoot);
  try {
    const raw = await readFile(join(dir, PROJECT_FILENAMES.feedback), "utf8");
    return JSON.parse(raw) as FeedbackPoint[];
  } catch {
    return [];
  }
}
