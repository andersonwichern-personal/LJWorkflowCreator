import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SCHEMA_PATH = join(process.cwd(), "docs/2026-07-15_live_schema.json");

export async function POST(_req: NextRequest) {
  try {
    const raw = await readFile(SCHEMA_PATH, "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync vocabulary schema" },
      { status: 500 }
    );
  }
}
