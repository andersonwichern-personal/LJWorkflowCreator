export {};

import { roleHolderExclusions } from "../lib/services/customer";

let failures = 0;

function t(name: string, cond: boolean) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
}

const exclusions = roleHolderExclusions(
  [
    { id: "r1", orgId: "org-test", requestId: "req1", customerId: "c1", role: "Borrower" },
    { id: "r2", orgId: "org-test", requestId: "req1", customerId: "c2", role: "Guarantor" },
  ],
  [
    { id: "c1", orgId: "org-test", type: "Business", name: "Prairie Gold", status: "active", mergedIntoId: null, version: 1 },
    { id: "c2", orgId: "org-test", type: "Individual", name: "Dale Hendricks", status: "active", mergedIntoId: null, version: 1 },
  ]
);

t("role-holder exclusions include borrower seat", exclusions.includes("u-prairie-gold"));
t("role-holder exclusions include guarantor seat", exclusions.includes("u-dale-hendricks"));
t("role-holder exclusions dedupe seat ids", new Set(exclusions).size === exclusions.length);

if (failures) {
  process.exit(1);
}
