/**
 * Job-posting extraction + storage (Task 3.1, spec §5/§9). Pastes of arbitrary
 * text are run through the provider to produce a JobRequirements, which is
 * stored in jobposting.json as { rawText, extractedRequirements }. Arbitrary
 * text must never crash extraction — the Zod-retry loop guarantees a valid
 * shape or a surfaced error.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  JobRequirementsSchema,
  type JobRequirements,
  type LLMProvider,
} from "@/lib/llm";
import {
  JD_EXTRACTION_SYSTEM,
  buildJdExtractionUser,
} from "@/lib/prompts/jdExtraction";
import { PROJECT_FILENAMES, atomicWriteJson, getProjectDir } from "@/lib/storage";
import { getDataRoot } from "@/lib/storage";

export interface JobPostingFile {
  rawText: string;
  extractedRequirements: JobRequirements;
}

export interface ExtractJobPostingInput {
  projectId: string;
  provider: LLMProvider;
  rawText: string;
  dataRoot?: string;
}

export async function extractAndStoreJobPosting(
  input: ExtractJobPostingInput,
): Promise<JobRequirements> {
  const dataRoot = input.dataRoot ?? getDataRoot();
  const dir = getProjectDir(input.projectId, dataRoot);

  const requirements = await input.provider.generateStructured({
    system: JD_EXTRACTION_SYSTEM,
    user: buildJdExtractionUser(input.rawText),
    schema: JobRequirementsSchema,
  });

  // Trust the user's pasted text for rawText rather than the model's echo, so
  // the stored posting always matches exactly what was submitted.
  const requirementsWithText: JobRequirements = {
    ...requirements,
    rawText: input.rawText,
  };

  const file: JobPostingFile = {
    rawText: input.rawText,
    extractedRequirements: requirementsWithText,
  };
  await atomicWriteJson(join(dir, PROJECT_FILENAMES.jobposting), file);
  return requirementsWithText;
}

/** Read stored JobRequirements, or null if no JD has been added. */
export async function readJobRequirements(
  projectId: string,
  dataRoot: string = getDataRoot(),
): Promise<JobRequirements | null> {
  const dir = getProjectDir(projectId, dataRoot);
  try {
    const raw = await readFile(join(dir, PROJECT_FILENAMES.jobposting), "utf8");
    const parsed = JSON.parse(raw) as JobPostingFile;
    return parsed.extractedRequirements ?? null;
  } catch {
    return null;
  }
}
