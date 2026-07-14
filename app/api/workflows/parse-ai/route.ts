import { NextRequest, NextResponse } from "next/server";
import { parseInstruction } from "@/lib/nlParser";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { instruction?: string; forceEvent?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.instruction) {
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  }

  const hasKey = !!process.env.GEMINI_API_KEY;

  // Deterministic fallback stub:
  const result = parseInstruction(body.instruction, { forceEvent: body.forceEvent });

  return NextResponse.json({
    rule: result.rule,
    notes: result.notes,
    suggestions: [], // Codex will implement dynamic suggestions
    unresolved: result.unresolved,
    uncovered: result.uncovered,
    ambiguities: result.ambiguities,
    engine: hasKey ? "gemini" : "heuristic",
  });
}
