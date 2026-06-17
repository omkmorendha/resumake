import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { PROJECT_FILENAMES, getProjectDir, isValidProjectId } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:id/pdf — serve the compiled PDF inline (for the preview
 * pane). Distinct from /export (which forces a download).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidProjectId(id)) {
    return NextResponse.json(
      { error: { code: "BAD_PROJECT_ID", message: "Invalid project id." } },
      { status: 400 },
    );
  }

  let data: Buffer;
  try {
    data = await readFile(join(getProjectDir(id), PROJECT_FILENAMES.resumePdf));
  } catch {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "No compiled PDF." } },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": "inline; filename=\"resume.pdf\"",
      "cache-control": "no-store",
    },
  });
}
