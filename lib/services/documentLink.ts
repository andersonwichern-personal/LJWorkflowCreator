import { prisma } from "@/lib/prisma";
import { DocumentLink } from "@prisma/client";

/**
 * Phase 8 (§3): prototype-owned document↔request junction. One canonical
 * document (owned by the admin documents service — linkage support there is
 * UNCONFIRMED) can satisfy several requests' checklists; this index never
 * becomes a second source of truth for the document itself. Approval status
 * stays per-request — it does not live on the link.
 */

const DAY_MS = 86_400_000;

/**
 * Pure window predicate behind `expiringWithin` — exported (no prisma) so the
 * boundary math is unit-testable with a passed clock. A link is "expiring
 * within N days" when validUntil is inside [now, now + N days], inclusive on
 * both edges; a null/invalid validUntil never expires.
 */
export function isExpiringWithin(
  validUntilIso: string | null,
  days: number,
  nowIso: string
): boolean {
  if (!validUntilIso) return false;
  const validUntil = Date.parse(validUntilIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(validUntil) || Number.isNaN(now)) return false;
  return validUntil >= now && validUntil <= now + days * DAY_MS;
}

export interface LinkDocumentInput {
  documentId: string;
  requestId: string;
  purpose?: string | null;
  /** ISO timestamp. */
  validFrom?: string | null;
  /** ISO timestamp — expiry, drives the refresh check. */
  validUntil?: string | null;
  linkedBy: string;
}

/** Prisma unique-constraint violation, checked structurally (code P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002"
  );
}

export class DocumentLinkService {
  static async listForRequest(orgId: string, requestId: string): Promise<DocumentLink[]> {
    if (!orgId) throw new Error("Organization ID is required to list document links");
    return prisma.documentLink.findMany({
      where: { orgId, requestId },
      orderBy: { linkedAt: "desc" },
    });
  }

  static async listForDocument(orgId: string, documentId: string): Promise<DocumentLink[]> {
    if (!orgId) throw new Error("Organization ID is required to list document links");
    return prisma.documentLink.findMany({
      where: { orgId, documentId },
      orderBy: { linkedAt: "desc" },
    });
  }

  /**
   * Link a document to a request. Idempotent on the
   * `@@unique([documentId, requestId])` key: linking an already-linked pair
   * returns the existing row (first via lookup, then via a P2002 catch for
   * the concurrent-create race) instead of throwing.
   */
  static async link(orgId: string, input: LinkDocumentInput): Promise<DocumentLink> {
    if (!orgId) throw new Error("Organization ID is required to link a document");
    if (!input.documentId || !input.requestId || !input.linkedBy) {
      throw new Error("documentId, requestId and linkedBy are required to link a document");
    }
    const existing = await prisma.documentLink.findFirst({
      where: { orgId, documentId: input.documentId, requestId: input.requestId },
    });
    if (existing) return existing;
    try {
      return await prisma.documentLink.create({
        data: {
          orgId,
          documentId: input.documentId,
          requestId: input.requestId,
          purpose: input.purpose ?? null,
          validFrom: input.validFrom ? new Date(input.validFrom) : null,
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          linkedBy: input.linkedBy,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const row = await prisma.documentLink.findFirst({
          where: { orgId, documentId: input.documentId, requestId: input.requestId },
        });
        if (row) return row;
        // The unique key collided with another tenant's row — not idempotence.
        throw new Error("Document link not found or access denied");
      }
      throw err;
    }
  }

  /** Remove a link, tenant-scoped — deleting another org's row is a 404, not a leak. */
  static async unlink(orgId: string, id: string): Promise<void> {
    if (!orgId) throw new Error("Organization ID is required to unlink a document");
    const result = await prisma.documentLink.deleteMany({ where: { id, orgId } });
    if (result.count === 0) {
      throw new Error("Document link not found or access denied");
    }
  }

  /**
   * Links whose validUntil falls inside [now, now + days] — pure date math on
   * the passed clock (`nowIso`), no Date.now(). Same window semantics as
   * `isExpiringWithin` above.
   */
  static async expiringWithin(
    orgId: string,
    days: number,
    nowIso: string
  ): Promise<DocumentLink[]> {
    if (!orgId) throw new Error("Organization ID is required to list expiring document links");
    const now = Date.parse(nowIso);
    if (Number.isNaN(now)) {
      throw new Error(`Invalid nowIso: ${JSON.stringify(nowIso)}`);
    }
    return prisma.documentLink.findMany({
      where: {
        orgId,
        validUntil: {
          not: null,
          gte: new Date(now),
          lte: new Date(now + days * DAY_MS),
        },
      },
      orderBy: { validUntil: "asc" },
    });
  }
}
