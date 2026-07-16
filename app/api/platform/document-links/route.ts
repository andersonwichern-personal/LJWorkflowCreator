import { NextRequest, NextResponse } from "next/server";
import { DocumentLinkService } from "@/lib/services/documentLink";

export const dynamic = "force-dynamic";

/** Fixed demo tenant fallback (real app derives org_id from the authed session). */
const DEFAULT_ORG_ID = "test-org-uuid-999";

function orgIdFrom(req: NextRequest): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("orgId") || searchParams.get("org_id") || DEFAULT_ORG_ID;
}

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = /not found|access denied/i.test(message)
    ? 404
    : /required|must be|invalid/i.test(message)
    ? 400
    : 500;
  return NextResponse.json({ error: message }, { status });
}

// GET /api/platform/document-links?requestId= | ?documentId= | ?expiringDays=N
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orgId = orgIdFrom(req);
    const requestId = searchParams.get("requestId");
    const documentId = searchParams.get("documentId");
    const expiringDays = searchParams.get("expiringDays");

    if (expiringDays !== null) {
      const days = Number(expiringDays);
      if (!Number.isFinite(days) || days < 0) {
        return NextResponse.json(
          { error: "expiringDays must be a non-negative number" },
          { status: 400 }
        );
      }
      // Clock read is allowed at the route edge — the lib math stays pure.
      const links = await DocumentLinkService.expiringWithin(
        orgId,
        days,
        new Date().toISOString()
      );
      return NextResponse.json({ links });
    }
    if (requestId) {
      const links = await DocumentLinkService.listForRequest(orgId, requestId);
      return NextResponse.json({ links });
    }
    if (documentId) {
      const links = await DocumentLinkService.listForDocument(orgId, documentId);
      return NextResponse.json({ links });
    }
    return NextResponse.json(
      { error: "Provide requestId, documentId, or expiringDays" },
      { status: 400 }
    );
  } catch (error: unknown) {
    console.error("Failed to list document links:", error);
    return errorResponse(error, "Failed to list document links");
  }
}

// POST /api/platform/document-links — link a document to a request (idempotent)
export async function POST(req: NextRequest) {
  try {
    const orgId = orgIdFrom(req);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const documentId = typeof body?.documentId === "string" ? body.documentId : "";
    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    const linkedBy = typeof body?.linkedBy === "string" ? body.linkedBy : "";
    if (!documentId || !requestId || !linkedBy) {
      return NextResponse.json(
        { error: "documentId, requestId and linkedBy are required" },
        { status: 400 }
      );
    }
    const link = await DocumentLinkService.link(orgId, {
      documentId,
      requestId,
      linkedBy,
      purpose: typeof body?.purpose === "string" ? body.purpose : null,
      validFrom: typeof body?.validFrom === "string" ? body.validFrom : null,
      validUntil: typeof body?.validUntil === "string" ? body.validUntil : null,
    });
    return NextResponse.json({ link }, { status: 201 });
  } catch (error: unknown) {
    console.error("Failed to link document:", error);
    return errorResponse(error, "Failed to link document");
  }
}

// DELETE /api/platform/document-links?id= — remove one link (tenant-scoped)
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await DocumentLinkService.unlink(orgIdFrom(req), id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Failed to unlink document:", error);
    return errorResponse(error, "Failed to unlink document");
  }
}
