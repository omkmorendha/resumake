import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import {
  PROJECT_FILENAMES,
  getProjectDir,
  isValidProjectId,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

const FORMATS = {
  tex: { file: PROJECT_FILENAMES.resumeTex, type: "application/x-tex", ext: "tex" },
  pdf: { file: PROJECT_FILENAMES.resumePdf, type: "application/pdf", ext: "pdf" },
} as const;

type Format = keyof typeof FORMATS;

/**
 * GET /api/projects/:id/export?format=tex|pdf — download the project's source
 * or compiled PDF as an attachment.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidProjectId(id)) {
    return errorResponse("BAD_PROJECT_ID", "Invalid project id.", 400);
  }

  const format = new URL(req.url).searchParams.get("format");
  if (format !== "tex" && format !== "pdf") {
    return errorResponse(
      "BAD_FORMAT",
      "Query param `format` must be `tex` or `pdf`.",
      400,
    );
  }

  const spec = FORMATS[format as Format];
  const path = join(getProjectDir(id), spec.file);

  let data: Buffer;
  try {
    data = await readFile(path);
  } catch {
    return errorResponse(
      "NOT_FOUND",
      `No ${format} available for this project.`,
      404,
    );
  }

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "content-type": spec.type,
      "content-disposition": `attachment; filename="resume.${spec.ext}"`,
      "content-length": String(data.byteLength),
    },
  });
}
