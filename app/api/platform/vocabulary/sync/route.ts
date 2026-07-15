import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SCHEMA_PATH = new URL("../../../../../docs/2026-07-15_live_schema.json", import.meta.url);

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
