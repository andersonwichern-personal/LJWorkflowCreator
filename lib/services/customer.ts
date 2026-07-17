import { REQUESTS } from "@sweet/rule-core";
import { approverIdFor } from "@/lib/viewpoint";

export interface CustomerRecord {
  id: string;
  orgId: string;
  type: "Business" | "Individual";
  name: string;
  status: "active" | "merged" | "archived";
  mergedIntoId: string | null;
  version: number;
}

export interface RequestCustomerRole {
  id: string;
  orgId: string;
  requestId: string;
  customerId: string;
  role: string;
}

function customerLabel(name: string): string {
  return name.trim();
}

async function getPrisma() {
  const mod = await import("@/lib/prisma");
  return mod.prisma;
}

export function toCustomerRecord(row: {
  id: string;
  orgId: string;
  type: string;
  name: string;
  status: string;
  mergedIntoId: string | null;
  version: number;
}): CustomerRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    type: row.type as "Business" | "Individual",
    name: row.name,
    status: row.status as "active" | "merged" | "archived",
    mergedIntoId: row.mergedIntoId,
    version: row.version,
  };
}

export function sortCustomersByName<T extends { name: string }>(customers: readonly T[]): T[] {
  return [...customers].sort((a, b) => a.name.localeCompare(b.name));
}

async function seedCustomers(orgId: string): Promise<void> {
  const prisma = await getPrisma();
  for (const request of REQUESTS) {
    const name = customerLabel(request.mainBorrower);
    let customer = await prisma.customer.findFirst({ where: { orgId, name } });
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          orgId,
          type: request.customerType,
          name,
          status: "active",
        },
      });
    }
    await prisma.requestCustomerRole.upsert({
      where: {
        requestId_customerId_role: {
          requestId: request.id,
          customerId: customer.id,
          role: "Borrower",
        },
      },
      update: {},
      create: {
        orgId,
        requestId: request.id,
        customerId: customer.id,
        role: "Borrower",
      },
    });
  }
}

export class CustomerService {
  static async listActive(orgId: string): Promise<CustomerRecord[]> {
    const prisma = await getPrisma();
    await seedCustomers(orgId);
    const rows = await prisma.customer.findMany({
      where: { orgId, status: "active" },
      orderBy: { name: "asc" },
    });
    return sortCustomersByName(rows.map(toCustomerRecord));
  }

  static async listAll(orgId: string): Promise<CustomerRecord[]> {
    const prisma = await getPrisma();
    await seedCustomers(orgId);
    const rows = await prisma.customer.findMany({
      where: { orgId },
      orderBy: { name: "asc" },
    });
    return sortCustomersByName(rows.map(toCustomerRecord));
  }

  static async listRolesForRequest(orgId: string, requestId: string): Promise<RequestCustomerRole[]> {
    const prisma = await getPrisma();
    await seedCustomers(orgId);
    const rows = await prisma.requestCustomerRole.findMany({ where: { orgId, requestId } });
    return rows.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      requestId: row.requestId,
      customerId: row.customerId,
      role: row.role,
    }));
  }

  static async relatedTo(orgId: string, customerId: string): Promise<CustomerRecord[]> {
    const prisma = await getPrisma();
    const { loadCustomerGraph } = await import("./customerGraph");
    await seedCustomers(orgId);
    const [graph, customers] = await Promise.all([
      loadCustomerGraph(orgId, customerId),
      prisma.customer.findMany({ where: { orgId } }),
    ]);
    const byId = new Map(customers.map((row) => [row.id, toCustomerRecord(row)]));
    return sortCustomersByName(
      graph.connected
      .map((node) => byId.get(node.id))
      .filter((node): node is CustomerRecord => Boolean(node))
    );
  }
}

export function roleHolderExclusions(roles: RequestCustomerRole[], customers: CustomerRecord[]): string[] {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const out = new Set<string>();
  for (const role of roles) {
    const customer = byId.get(role.customerId);
    if (!customer) continue;
    out.add(approverIdFor(customer.name));
  }
  return [...out];
}

export async function dynamicExclusionsForRequest(
  orgId: string,
  requestId: string,
  staticSeed: string[]
): Promise<string[]> {
  const [roles, customers] = await Promise.all([
    CustomerService.listRolesForRequest(orgId, requestId),
    CustomerService.listActive(orgId),
  ]);
  const dynamic = roleHolderExclusions(roles, customers);
  return [...new Set([...staticSeed, ...dynamic])];
}
