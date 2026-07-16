import { prisma } from "@/lib/prisma";
import { Delegation } from "@prisma/client";

export type ActiveDelegation = { fromId: string; toId: string };

export class DelegationService {
  static async listActive(
    orgId: string,
    scope = "all",
    at = new Date()
  ): Promise<ActiveDelegation[]> {
    if (!orgId) {
      throw new Error("Organization ID is required to list delegations");
    }
    const rows = await prisma.delegation.findMany({
      where: {
        orgId,
        startsAt: { lte: at },
        endsAt: { gte: at },
        OR: [{ scope: "all" }, { scope }],
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((d) => ({ fromId: d.fromUserId, toId: d.toUserId }));
  }

  static async create(data: {
    orgId: string;
    fromUserId: string;
    toUserId: string;
    scope?: string;
    startsAt: Date;
    endsAt: Date;
    reason: string;
  }): Promise<Delegation> {
    if (!data.orgId) throw new Error("Organization ID is required to create a delegation");
    if (!data.fromUserId?.trim()) throw new Error("Delegating user is required");
    if (!data.toUserId?.trim()) throw new Error("Delegate user is required");
    if (!data.reason?.trim()) throw new Error("Delegation reason is required");
    if (data.endsAt <= data.startsAt) throw new Error("Delegation end must be after its start");

    return prisma.delegation.create({
      data: {
        orgId: data.orgId,
        fromUserId: data.fromUserId.trim(),
        toUserId: data.toUserId.trim(),
        scope: data.scope?.trim() || "all",
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        reason: data.reason.trim(),
      },
    });
  }
}
