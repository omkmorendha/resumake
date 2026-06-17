import { NextResponse } from "next/server";

import { applyEdit } from "@/lib/projects/applyEdit";
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

  try {
    const result = await applyEdit({
      projectId: id,
      pointId: body.pointId,
      diff: body.diff,
      acceptedHunks: body.acceptedHunks,
    });
    return NextResponse.json({
      version: result.version,
      source: result.source,
      compiled: result.compiled,
      compileError: result.compileError ?? null,
      point: result.point,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Apply failed.";
    return errorResponse("APPLY_FAILED", message, 500);
  }
}
