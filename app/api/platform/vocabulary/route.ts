import { NextResponse } from "next/server";
import { fetchLiveVocabulary, platformConfigured } from "@/lib/platform";

// Live data must never be cached across tenants/tokens.
export const dynamic = "force-dynamic";

/**
 * GET /api/platform/vocabulary — server proxy for the demo bridge.
 *
 * Aggregates the live Landjourney building blocks (users, retailers, request
 * templates + stages, forms) for the builder's pickers. The bearer token stays
 * server-side. Always answers 200 with a `source` discriminator so the client
 * fallback logic stays trivial.
 */
export async function GET() {
  if (!platformConfigured()) {
    return NextResponse.json({
      source: "static",
      reason: "platform env not configured (LANDJOURNEY_API_BASE / _API_TOKEN / _ORG_ID)",
    });
  }
  try {
    return NextResponse.json(await fetchLiveVocabulary());
  } catch (error: unknown) {
    return NextResponse.json({
      source: "static",
      reason: error instanceof Error ? error.message : "live fetch failed",
    });
  }
}
