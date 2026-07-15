import { NextRequest, NextResponse } from "next/server";
import { CustomerService, toCustomerRecord } from "@/lib/services/customer";
import { aggregateExposure } from "@/lib/services/exposure";

const DEFAULT_ORG_ID = "test-org-uuid-999";

function orgIdFrom(req: NextRequest): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("orgId") || searchParams.get("org_id") || DEFAULT_ORG_ID;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestId = searchParams.get("requestId");
    const orgId = orgIdFrom(req);
    const [customers, roles] = await Promise.all([
      CustomerService.listAll(orgId),
      requestId ? CustomerService.listRolesForRequest(orgId, requestId) : Promise.resolve([]),
    ]);
    const summaries = await Promise.all(
      customers.map(async (customer) => {
        const exposure = await aggregateExposure(orgId, customer.id);
        return {
          customerId: customer.id,
          canonicalCustomerId: exposure.summary.canonicalCustomerId,
          connectedPartyCount: exposure.summary.connectedPartyCount,
          relationshipCount: exposure.summary.relationshipCount,
          brokenReferenceCount: exposure.summary.brokenReferenceCount,
          connectedCustomers: exposure.summary.connectedCustomers,
        };
      })
    );
    return NextResponse.json({
      customers: customers.map(toCustomerRecord),
      roles,
      summaries,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list customers" },
      { status: 500 }
    );
  }
}
