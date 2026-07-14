import { NextResponse } from "next/server";
import { fetchSessionOrgId, platformConfigured } from "@/lib/platform";

export const dynamic = "force-dynamic";

/** Demo tenant used only when no real org can be resolved (alignment doc §4c/§8). */
const DEMO_FALLBACK_ORG_ID = "test-org-uuid-999";

/**
 * GET /api/platform/me — resolve the tenant identity for the client.
 *
 * One real org everywhere: the same org id scopes both Supabase persistence
 * and the platform bridge. Live session org (iam/users/me) → env org → demo
 * constant, in that order.
 */
export async function GET() {
  const orgId = await fetchSessionOrgId();
  if (orgId) {
    return NextResponse.json({
      orgId,
      source: platformConfigured() ? "live" : "env",
    });
  }
  return NextResponse.json({ orgId: DEMO_FALLBACK_ORG_ID, source: "demo" });
}
