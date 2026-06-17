import { NextResponse } from "next/server";

import { restoreVersion } from "@/lib/projects/versions";
import { isValidProjectId, readProject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/projects/:id/versions/:n/restore — restore a snapshot (spec §10):
 * snapshot current first, write the target source, recompile, re-parse.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  const { id, n } = await params;
  if (!isValidProjectId(id)) {
    return errorResponse("BAD_PROJECT_ID", "Invalid project id.", 400);
  }
  const meta = await readProject(id);
  if (!meta) {
    return errorResponse("NOT_FOUND", "Project not found.", 404);
  }
  const version = Number(n);
  if (!Number.isInteger(version) || version < 1) {
    return errorResponse("BAD_VERSION", "Version must be a positive integer.", 400);
  }

  try {
    const result = await restoreVersion(id, version, new Date().toISOString());
    return NextResponse.json({
      snapshotVersion: result.snapshotVersion,
      source: result.source,
      compiled: result.compiled,
      compileError: result.compileError ?? null,
      sectionIds: result.sectionIds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Restore failed.";
    // A missing snapshot file is the common case → 404.
    if (message.includes("ENOENT")) {
      return errorResponse("NOT_FOUND", `Version ${version} not found.`, 404);
    }
    return errorResponse("RESTORE_FAILED", message, 500);
  }
}
