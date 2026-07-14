import { NextRequest, NextResponse } from "next/server";
import { WorkflowService } from "@/lib/services/workflow";
import { ApprovalAuthorityService } from "@/lib/services/authority";
import { auditWorkflowRefs } from "@/lib/refAudit";
import { fetchLiveVocabulary, platformConfigured } from "@/lib/platform";
import { ScopedInstances, emptyInstances } from "@/lib/liveVocabulary";

export const dynamic = "force-dynamic";

/** Fixed demo tenant fallback, matching the platform routes. */
const DEFAULT_ORG_ID = "test-org-uuid-999";

/**
 * GET /api/workflows/audit-refs — on-demand broken-reference audit (§4.5).
 *
 * Loads the org's workflows + the live instance registries and reports every
 * instance-shaped reference as ok | missing | legacy-unresolved. When the
 * platform bridge isn't configured, `verified:false` and only shape-based
 * checks (legacy-unresolved) are meaningful.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("orgId") || searchParams.get("org_id") || DEFAULT_ORG_ID;

  try {
    const workflows = await WorkflowService.listWorkflows(orgId);

    // Registries are verified PER SOURCE (empty = unverifiable, never a false
    // alarm). Authorities come from the DB and verify even without the bridge.
    const registry: ScopedInstances = emptyInstances();
    try {
      const authorities = await ApprovalAuthorityService.listAuthorities(orgId);
      registry.authorities = authorities.map((a) => ({ id: a.id, label: a.name }));
    } catch {
      /* authorities unverifiable */
    }
    if (platformConfigured()) {
      try {
        const vocab = await fetchLiveVocabulary();
        if (vocab.source === "live") {
          registry.templates = vocab.templates.map((t) => ({ id: t.id, label: t.name }));
          registry.retailers = vocab.retailers;
          registry.users = vocab.users;
          registry.stages = vocab.templates.flatMap((t) =>
            t.stages.map((s) => ({ id: `${t.id}:${s.id}`, label: `${t.name} › ${s.label}` }))
          );
        }
      } catch {
        /* live fetch failed — those sources stay unverifiable */
      }
    }

    const result = auditWorkflowRefs(
      workflows.map((w) => ({ id: w.id, name: w.name, ruleJson: w.ruleJson })),
      registry
    );
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Reference audit failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reference audit failed" },
      { status: 500 }
    );
  }
}
