import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import {
  PROJECT_FILENAMES,
  getProjectDir,
  isValidProjectId,
  readProject,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * GET /api/projects/:id — project metadata plus the current `resume.tex`
 * source (and whether a compiled PDF exists). Used to hydrate the workspace.
 */
export async function GET(
  _req: Request,
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

  const dir = getProjectDir(id);
  let source = "";
  try {
    source = await readFile(join(dir, PROJECT_FILENAMES.resumeTex), "utf8");
  } catch {
    // No source yet — leave empty.
  }

  let hasPdf = false;
  try {
    await readFile(join(dir, PROJECT_FILENAMES.resumePdf));
    hasPdf = true;
  } catch {
    hasPdf = false;
  }

  return NextResponse.json({ project: meta, source, hasPdf });
}
