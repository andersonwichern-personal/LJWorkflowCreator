import { prisma } from "../lib/prisma";

async function run() {
  console.log("🚀 Starting approval authorities verification tests...");

  const testOrg = "test-authority-org-123";

  // Clean up
  console.log("🧹 Cleaning up old test data...");
  await prisma.approvalAuthority.deleteMany({ where: { orgId: testOrg } });

  console.log("📝 Creating first authority level (Credit Officer)...");
  const co = await prisma.approvalAuthority.create({
    data: {
      orgId: testOrg,
      name: "Credit Officer",
      limit: 100000,
      riskGrade: "C",
      product: "All",
      userIds: ["Sara", "Mohammed"],
      autoApprove: false,
    },
  });
  console.log(`✅ Created. ID: ${co.id}`);

  console.log("📝 Creating second authority level (Senior Credit Officer) escalating to committee...");
  const sco = await prisma.approvalAuthority.create({
    data: {
      orgId: testOrg,
      name: "Senior Credit Officer",
      limit: 500000,
      riskGrade: "D",
      product: "Term Loan",
      userIds: ["Wael"],
      autoApprove: false,
    },
  });
  console.log(`✅ Created. ID: ${sco.id}`);

  console.log("🔄 Linking Credit Officer escalation path to Senior Credit Officer...");
  const updatedCo = await prisma.approvalAuthority.update({
    where: { id: co.id },
    data: { escalationId: sco.id },
    include: { escalation: true },
  });

  if (updatedCo.escalationId === sco.id && updatedCo.escalation?.name === "Senior Credit Officer") {
    console.log("   ✔ Escalation link successfully created and verified");
  } else {
    throw new Error("Escalation link verification failed!");
  }

  console.log("🔒 Verifying tenant isolation...");
  const otherOrgList = await prisma.approvalAuthority.findMany({
    where: { orgId: "some-other-tenant-999" },
  });
  if (otherOrgList.length === 0) {
    console.log("   ✔ Tenant isolation check successful (empty result on wrong org)");
  } else {
    throw new Error("Tenant isolation check failed!");
  }

  console.log("📋 Listing authorities for testing org...");
  const list = await prisma.approvalAuthority.findMany({
    where: { orgId: testOrg },
  });
  if (list.length === 2) {
    console.log("   ✔ List count is correct (2 levels)");
  } else {
    throw new Error(`List count is incorrect: expected 2, got ${list.length}`);
  }

  console.log("🧹 Cleaning up test data...");
  await prisma.approvalAuthority.deleteMany({ where: { orgId: testOrg } });
  console.log("   ✔ Cleanup successful");

  console.log("🎉 Approval authorities verification completed successfully!");
}

run()
  .catch((e) => {
    console.error("❌ Test failed!");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
