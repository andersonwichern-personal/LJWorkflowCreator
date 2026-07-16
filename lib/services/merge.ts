import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { rewriteCustomerInstanceRefs } from "@/lib/customerRefRewrite";

export interface MergeResult {
  survivorId: string;
  duplicateId: string;
  movedRoles: number;
  movedRelationships: number;
  /** Workflows whose customer_name refs were repointed dup → survivor (§9, principle B). */
  ruleRefsRepointed: { workflowId: string; name: string }[];
  noOp?: boolean;
}

/**
 * Merge a duplicate customer into a survivor (edge-cases doc §9).
 *
 * Principle A (alias, don't rewrite): the duplicate is never deleted — it is
 * marked `merged` with `mergedIntoId = survivor`, so historical audit rows that
 * referenced it still resolve one hop forever. Principle E (optimistic
 * concurrency): the caller may pass `expectedVersion` to fail a merge that races
 * an edit to the duplicate. Principle B (one scanner): workflow rules pointing at
 * the duplicate are repointed to the survivor via the shared ref rewriter.
 *
 * Aggregate-exposure recompute (T6) is intentionally out of scope for this slice
 * (deferred — no cross-request query path yet); no fabricated exposure is written.
 */
export async function mergeCustomers(
  survivorId: string,
  duplicateId: string,
  orgId: string,
  opts: { actorId: string; reason: string; expectedVersion?: number }
): Promise<MergeResult> {
  if (!survivorId || !duplicateId) {
    throw new Error("Both survivorId and duplicateId are required");
  }
  if (survivorId === duplicateId) {
    throw new Error("A customer cannot be merged into itself");
  }

  const [survivor, duplicate] = await Promise.all([
    prisma.customer.findFirst({ where: { id: survivorId, orgId } }),
    prisma.customer.findFirst({ where: { id: duplicateId, orgId } }),
  ]);
  if (!survivor || !duplicate) {
    throw new Error("Customer not found or access denied");
  }
  if (typeof opts.expectedVersion === "number" && duplicate.version !== opts.expectedVersion) {
    throw new Error("Customer merge conflict: stale version");
  }
  // Already merged into this survivor → idempotent no-op (safe to re-run).
  if (duplicate.status === "merged" && duplicate.mergedIntoId === survivorId) {
    return {
      survivorId,
      duplicateId,
      movedRoles: 0,
      movedRelationships: 0,
      ruleRefsRepointed: [],
      noOp: true,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Repoint request roles + relationship edges from duplicate → survivor.
    const [roles, fromRels, toRels] = await Promise.all([
      tx.requestCustomerRole.updateMany({
        where: { orgId, customerId: duplicateId },
        data: { customerId: survivorId },
      }),
      tx.customerRelationship.updateMany({
        where: { orgId, fromId: duplicateId },
        data: { fromId: survivorId },
      }),
      tx.customerRelationship.updateMany({
        where: { orgId, toId: duplicateId },
        data: { toId: survivorId },
      }),
    ]);

    // 2. Repoint workflow rule refs (customer_name instance refs) dup → survivor.
    const workflows = await tx.workflow.findMany({ where: { orgId } });
    const ruleRefsRepointed: { workflowId: string; name: string }[] = [];
    for (const wf of workflows) {
      const { rule, changed } = rewriteCustomerInstanceRefs(
        wf.ruleJson,
        duplicateId,
        survivorId,
        survivor.name
      );
      if (!changed) continue;
      await tx.workflow.update({
        where: { id: wf.id },
        data: { ruleJson: rule as unknown as Prisma.InputJsonValue },
      });
      ruleRefsRepointed.push({ workflowId: wf.id, name: wf.name });
    }

    // 3. Alias the duplicate (never delete) + append an immutable audit row.
    await Promise.all([
      tx.customer.update({
        where: { id: duplicateId },
        data: {
          status: "merged",
          mergedIntoId: survivorId,
          version: { increment: 1 },
        },
      }),
      tx.platformAuditLog.create({
        data: {
          orgId,
          type: "CUSTOMERS_MERGED",
          subjectType: "customer",
          subjectId: duplicateId,
          payload: {
            survivorId,
            duplicateId,
            movedRoles: roles.count,
            movedRelationships: fromRels.count + toRels.count,
            ruleRefsRepointed: ruleRefsRepointed.map((r) => r.workflowId),
            reason: opts.reason,
          },
          actorId: opts.actorId,
        },
      }),
    ]);

    return {
      movedRoles: roles.count,
      movedRelationships: fromRels.count + toRels.count,
      ruleRefsRepointed,
    };
  });

  return {
    survivorId,
    duplicateId,
    movedRoles: result.movedRoles,
    movedRelationships: result.movedRelationships,
    ruleRefsRepointed: result.ruleRefsRepointed,
  };
}
