import { NextResponse } from "next/server";

import { readVersionIndex } from "@/lib/projects/versions";
import { isValidProjectId, readProject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/projects/:id/versions — list snapshots (spec §10). */
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
  const meta = await readProject(id);
  if (!meta) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Project not found." } },
      { status: 404 },
    );
  }
  const versions = await readVersionIndex(id);
  return NextResponse.json({ versions });
}
