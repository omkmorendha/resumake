import { NextResponse } from "next/server";

import { dockerPreflight } from "@/lib/latex/preflight";

// Node runtime — the preflight shells out to the `docker` CLI.
export const runtime = "nodejs";
// Always evaluate live; Docker state changes out from under us.
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await dockerPreflight();
  return NextResponse.json(result);
}
