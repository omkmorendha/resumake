import { NextResponse } from "next/server";

import { createProjectFromTex } from "@/lib/projects/createFromTex";
import { listProjects, readProject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** GET /api/projects — list existing projects (id + name + provider). */
export async function GET() {
  const ids = await listProjects();
  const projects = (
    await Promise.all(ids.map((id) => readProject(id)))
  ).filter((p): p is NonNullable<typeof p> => p !== null);
  return NextResponse.json({ projects });
}

/**
 * POST /api/projects — create a project from a `.tex` upload, compile it, and
 * persist resume.pdf + compile.log. Accepts either multipart/form-data
 * (fields: `file` = .tex, `name`) or JSON `{ name, tex, provider? }`.
 */
export async function POST(req: Request) {
  let name: string | undefined;
  let tex: string | undefined;
  let provider: "claude" | "openai" | undefined;

  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file instanceof File) {
        tex = await file.text();
        name = (form.get("name") as string | null) ?? file.name.replace(/\.tex$/i, "");
      }
      const p = form.get("provider");
      if (p === "claude" || p === "openai") provider = p;
    } else {
      const body = (await req.json()) as {
        name?: string;
        tex?: string;
        provider?: string;
      };
      name = body.name;
      tex = body.tex;
      if (body.provider === "claude" || body.provider === "openai") {
        provider = body.provider;
      }
    }
  } catch {
    return errorResponse("BAD_REQUEST", "Could not parse request body.", 400);
  }

  if (!tex || tex.trim() === "") {
    return errorResponse("MISSING_TEX", "A non-empty .tex source is required.", 400);
  }
  if (!name || name.trim() === "") {
    name = "Untitled resume";
  }

  const result = await createProjectFromTex({ name, tex, provider });

  return NextResponse.json(
    {
      project: result.project,
      compiled: result.compiled,
      compileError: result.compileError ?? null,
    },
    { status: 201 },
  );
}
