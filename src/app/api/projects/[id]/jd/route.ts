import { NextResponse } from "next/server";

import { StructuredGenerationError } from "@/lib/llm";
import { getProvider, type ProviderName } from "@/lib/llm/providerFactory";
import {
  extractAndStoreJobPosting,
  readJobRequirements,
} from "@/lib/projects/jobPosting";
import { isValidProjectId, readProject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** GET /api/projects/:id/jd — the stored JobRequirements, or null. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidProjectId(id)) {
    return errorResponse("BAD_PROJECT_ID", "Invalid project id.", 400);
  }
  const requirements = await readJobRequirements(id);
  return NextResponse.json({ requirements });
}

/**
 * POST /api/projects/:id/jd — extract & store JobRequirements from pasted text
 * (spec §10). Body: { text, provider? }.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidProjectId(id)) {
    return errorResponse("BAD_PROJECT_ID", "Invalid project id.", 400);
  }
  const meta = await readProject(id);
  if (!meta) {
    return errorResponse("NOT_FOUND", "Project not found.", 404);
  }

  let text: string | undefined;
  let providerName: ProviderName | undefined;
  try {
    const body = (await req.json()) as { text?: string; provider?: string };
    text = body.text;
    if (body.provider === "claude" || body.provider === "openai") {
      providerName = body.provider;
    }
  } catch {
    return errorResponse("BAD_REQUEST", "Could not parse request body.", 400);
  }
  if (typeof text !== "string" || text.trim() === "") {
    return errorResponse("MISSING_TEXT", "A non-empty job posting is required.", 400);
  }

  try {
    const provider = await getProvider(providerName);
    const requirements = await extractAndStoreJobPosting({
      projectId: id,
      provider,
      rawText: text,
    });
    return NextResponse.json({ requirements });
  } catch (err) {
    if (err instanceof StructuredGenerationError) {
      return errorResponse(
        "EXTRACTION_FAILED",
        "Could not extract structured requirements from that text. Please try again.",
        502,
      );
    }
    const message = err instanceof Error ? err.message : "JD extraction failed.";
    return errorResponse("EXTRACTION_FAILED", message, 500);
  }
}
