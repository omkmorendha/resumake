import { NextResponse } from "next/server";

import { makeAgentHealer } from "@/lib/agent/healer";
import { getProvider } from "@/lib/llm/providerFactory";
import { applyEdit } from "@/lib/projects/applyEdit";
import type { Healer } from "@/lib/projects/selfHeal";
import { isValidProjectId, readProject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/projects/:id/edits/apply — apply an approved edit (spec §10).
 * Body: { pointId, diff, acceptedHunks }. Snapshots a version, applies the
 * accepted hunks, recompiles, re-parses, and marks the point addressed.
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

  let body: { pointId?: string; diff?: string; acceptedHunks?: boolean[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return errorResponse("BAD_REQUEST", "Could not parse request body.", 400);
  }
  if (!body.pointId || typeof body.diff !== "string" || !Array.isArray(body.acceptedHunks)) {
    return errorResponse(
      "BAD_REQUEST",
      "pointId, diff, and acceptedHunks are required.",
      400,
    );
  }

  // Build an agent-backed healer for self-heal (Task 4.5). If no provider is
  // configured (no token/key), the provider call inside the healer throws and
  // it returns null → apply falls back to error + one-click undo.
  let healer: Healer | undefined;
  try {
    const provider = await getProvider();
    healer = makeAgentHealer(provider);
  } catch {
    healer = undefined; // no provider configured → no auto-heal
  }

  try {
    const result = await applyEdit({
      projectId: id,
      pointId: body.pointId,
      diff: body.diff,
      acceptedHunks: body.acceptedHunks,
      healer,
    });
    return NextResponse.json({
      version: result.version,
      source: result.source,
      compiled: result.compiled,
      compileError: result.compileError ?? null,
      point: result.point,
      sectionIds: result.sectionIds,
      healAttempts: result.healAttempts ?? null,
      undoVersion: result.undoVersion ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Apply failed.";
    return errorResponse("APPLY_FAILED", message, 500);
  }
}
