import { join } from "node:path";

import { NextResponse } from "next/server";

import { compileAndPersist } from "@/lib/projects/compileAndPersist";
import {
  PROJECT_FILENAMES,
  atomicWrite,
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
 * POST /api/projects/:id/compile — compile the supplied `.tex` (the live
 * editor buffer), persist it as resume.tex, and recompile. Returns whether it
 * compiled and the parsed first error on failure. On failure the previous
 * resume.pdf is left in place so the preview can show a stale copy.
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

  let tex: string | undefined;
  try {
    const body = (await req.json()) as { tex?: string };
    tex = body.tex;
  } catch {
    return errorResponse("BAD_REQUEST", "Could not parse request body.", 400);
  }
  if (typeof tex !== "string" || tex.trim() === "") {
    return errorResponse("MISSING_TEX", "A non-empty .tex source is required.", 400);
  }

  // Persist the source first so the on-disk resume.tex matches what we compile.
  await atomicWrite(join(getProjectDir(id), PROJECT_FILENAMES.resumeTex), tex);

  let result;
  try {
    result = await compileAndPersist({ projectId: id, tex });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Compile failed.";
    return errorResponse("COMPILE_FAILED", message, 500);
  }

  return NextResponse.json({
    compiled: result.compiled,
    compileError: result.compileError ?? null,
  });
}
