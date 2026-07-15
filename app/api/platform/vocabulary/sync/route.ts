import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const filePath = path.join(process.cwd(), "docs", "2026-07-15_live_schema.json");
    const rawData = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(rawData);
    return NextResponse.json(parsed);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load live schema" },
      { status: 500 }
    );
  }
}
