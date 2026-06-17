import { NextResponse } from "next/server";

import { StructuredGenerationError } from "@/lib/llm";
import { getProvider, type ProviderName } from "@/lib/llm/providerFactory";
import { analyzeResume, readFeedback } from "@/lib/projects/analyze";
import { isValidProjectId, readProject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** GET /api/projects/:id/analyze — the last persisted FeedbackPoint[]. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidProjectId(id)) {
    return errorResponse("BAD_PROJECT_ID", "Invalid project id.", 400);
  }
  const points = await readFeedback(id);
  return NextResponse.json({ points });
}

/**
 * POST /api/projects/:id/analyze — run resume analysis (spec §10).
 * Body: { provider?: "claude" | "openai" }. Returns FeedbackPoint[] sorted by
 * severity. (JD-aware analysis arrives in M3.)
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

  let providerName: ProviderName | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { provider?: string };
    if (body.provider === "claude" || body.provider === "openai") {
      providerName = body.provider;
    }
  } catch {
    // No/invalid body → use the configured default provider.
  }

  try {
    const provider = await getProvider(providerName);
    const points = await analyzeResume({ projectId: id, provider });
    return NextResponse.json({ points });
  } catch (err) {
    if (err instanceof StructuredGenerationError) {
      return errorResponse(
        "ANALYSIS_FAILED",
        "The model did not return valid feedback after several attempts. Please try again.",
        502,
      );
    }
    const message = err instanceof Error ? err.message : "Analysis failed.";
    return errorResponse("ANALYSIS_FAILED", message, 500);
  }
}
