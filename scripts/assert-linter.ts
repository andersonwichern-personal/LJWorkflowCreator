/**
 * Rule linter suite — dead-condition detection, rejected-without-notice, and
 * prohibited-basis review warnings. Run:
 *   npx tsx scripts/assert-linter.ts
 */

import { lintRule, type LintContext } from "@sweet/rule-core";

let failures = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

function hasIssue(raw: unknown, code: string, severity: "error" | "warning", ctx?: LintContext): boolean {
  const { issues } = lintRule(raw, ctx);
  return issues.some((i) => i.code === code && i.severity === severity);
}

const base = {
  schemaVersion: 3,
  triggers: [{ event: "SYSTEM ERROR" }],
  conditions: { logic: "AND", children: [{ field: "bookstatus", operator: "is", value: "Error" }] },
  actions: [{ action: "assign_user", params: { assignee: "Escalation Team" } }],
  controls: { mode: "shadow", oncePerRequest: true, maxFiresPerHour: 25, missingData: "no_match", priority: 100 },
};

/* ---- DEAD_CONDITION -------------------------------------------------------- */
const deadConditionRule = {
  ...base,
  triggers: [{ event: "LOAN APPROVED" }],
  conditions: {
    logic: "OR",
    children: [
      {
        logic: "AND",
        children: [
          { field: "loan_amount", operator: "gt", value: "100" },
          { field: "loan_amount", operator: "lt", value: "50" },
        ],
      },
    ],
  },
};
t("DEAD_CONDITION: impossible numeric range is flagged", hasIssue(deadConditionRule, "DEAD_CONDITION", "error"));

const stringDeadRule = {
  ...base,
  conditions: {
    logic: "OR",
    children: [
      {
        logic: "AND",
        children: [
          { field: "bookstatus", operator: "is", value: "Error" },
          { field: "bookstatus", operator: "is_not", value: "Error" },
        ],
      },
    ],
  },
};
t("DEAD_CONDITION: exact plus exclusion is flagged", hasIssue(stringDeadRule, "DEAD_CONDITION", "error"));

/* ---- AUTO_REJECT_WITHOUT_NOTICE ------------------------------------------- */
const rejectedWithoutNotice = {
  ...base,
  actions: [{ action: "set_underwriting_result", params: { value: "Rejected" } }],
};
t(
  "AUTO_REJECT_WITHOUT_NOTICE: rejected underwriting needs notice",
  hasIssue(rejectedWithoutNotice, "AUTO_REJECT_WITHOUT_NOTICE", "error")
);

const rejectedWithNotice = {
  ...base,
  actions: [
    { action: "set_underwriting_result", params: { value: "Rejected" } },
    { action: "notify", params: { value: "Wael" } },
  ],
};
t(
  "AUTO_REJECT_WITHOUT_NOTICE: notify action clears the error",
  !hasIssue(rejectedWithNotice, "AUTO_REJECT_WITHOUT_NOTICE", "error")
);

/* ---- PROHIBITED_BASIS_REVIEW ---------------------------------------------- */
const prohibitedBasis = {
  ...base,
  conditions: { logic: "AND", children: [{ field: "customer_name", operator: "contains", value: "Prairie" }] },
};
t(
  "PROHIBITED_BASIS_REVIEW: sensitive-review basis emits warning",
  hasIssue(prohibitedBasis, "PROHIBITED_BASIS_REVIEW", "warning")
);

/* ---- BROKEN_REF (context-aware) ------------------------------------------- */
const userCtx: LintContext = {
  users: ["Wael", "Sara", "Escalation Team"],
  templates: ["form-1"],
  stages: ["Initial Review", "Closed"],
  liveFieldKeys: ["bookstatus"],
};
const brokenUser = { ...base, actions: [{ action: "notify", params: { value: "Ghost McGhost" } }] };
t("BROKEN_REF: notify to an unknown user is flagged", hasIssue(brokenUser, "BROKEN_REF", "error", userCtx));
t(
  "BROKEN_REF: a known user does not flag",
  !hasIssue({ ...base, actions: [{ action: "notify", params: { value: "Wael" } }] }, "BROKEN_REF", "error", userCtx)
);

const brokenStage = {
  ...base,
  conditions: { logic: "AND", children: [{ field: "stage", operator: "is", value: "Ghost Stage" }] },
};
t("BROKEN_REF: unknown stage condition is flagged", hasIssue(brokenStage, "BROKEN_REF", "error", userCtx));

const brokenTemplate = {
  ...base,
  triggers: [{ event: "SYSTEM ERROR", scope: { level: "instance", id: "tpl-missing", label: "Missing Template" } }],
};
t(
  "BROKEN_REF: unknown template trigger scope is flagged",
  hasIssue(brokenTemplate, "BROKEN_REF", "error", userCtx)
);

const authCtx: LintContext = { authorityIds: ["auth-live-1"] };
const brokenAuthority = {
  ...base,
  actions: [{ action: "assign_authority", params: { value: { level: "instance", id: "auth-deleted-9", label: "Old Level" } } }],
};
t("BROKEN_REF: assign_authority to a deleted level is flagged", hasIssue(brokenAuthority, "BROKEN_REF", "error", authCtx));

/* ---- MISSING_DATA_EXPOSURE ------------------------------------------------ */
t(
  "MISSING_DATA_EXPOSURE: field absent from live templates warns",
  hasIssue(base, "MISSING_DATA_EXPOSURE", "warning", { liveFieldKeys: ["loan_amount"] })
);
t(
  "MISSING_DATA_EXPOSURE: field present in live templates is clean",
  !hasIssue(base, "MISSING_DATA_EXPOSURE", "warning", { liveFieldKeys: ["bookstatus"] })
);

const liveFieldRule = {
  ...base,
  conditions: {
    logic: "AND",
    children: [
      {
        field: {
          kind: "formField",
          formTemplateId: "form-1",
          fieldId: "field-1",
          key: "newField3",
          label: "New Field 3",
          fieldKind: "text",
        },
        operator: "is_empty",
      },
    ],
  },
};
t(
  "MISSING_DATA_EXPOSURE: live form field key is honored",
  !hasIssue(liveFieldRule, "MISSING_DATA_EXPOSURE", "warning", { liveFieldKeys: ["ff:form-1:field-1"] })
);

/* ---- GATED_TOKEN_ARMED ---------------------------------------------------- */
const armedGated = { ...base, controls: { ...base.controls, mode: "armed" } };
t(
  "GATED_TOKEN_ARMED: armed rule with a backend-required action warns",
  hasIssue(armedGated, "GATED_TOKEN_ARMED", "warning")
);
t(
  "GATED_TOKEN_ARMED: an armed notify (executable) does not warn",
  !hasIssue(
    { ...base, controls: { ...base.controls, mode: "armed" }, actions: [{ action: "notify", params: { value: "Wael" } }] },
    "GATED_TOKEN_ARMED",
    "warning"
  )
);
t("GATED_TOKEN_ARMED: shadow rule never warns", !hasIssue(base, "GATED_TOKEN_ARMED", "warning"));

/* ---- OVERLAP -------------------------------------------------------------- */
const peerSuperset = {
  id: "wf-peer",
  name: "Error triage (broad)",
  enabled: true,
  rule: {
    schemaVersion: 3,
    triggers: [{ event: "SYSTEM ERROR" }],
    conditions: {
      logic: "AND",
      children: [
        { field: "bookstatus", operator: "is", value: "Error" },
        { field: "bookstatus", operator: "is_not", value: "Closed" },
      ],
    },
    actions: [{ action: "notify", params: { value: "Wael" } }],
    controls: { mode: "armed", oncePerRequest: true, maxFiresPerHour: 25, missingData: "no_match", priority: 100 },
  },
};
type Peers = NonNullable<LintContext["peers"]>;
t(
  "OVERLAP: subset of an active armed peer warns",
  hasIssue(base, "OVERLAP", "warning", { peers: [peerSuperset] as unknown as Peers })
);
t(
  "OVERLAP: a disabled peer does not warn",
  !hasIssue(base, "OVERLAP", "warning", { peers: [{ ...peerSuperset, enabled: false }] as unknown as Peers })
);

const clean = lintRule(base);
t("clean rule → no lint errors", clean.issues.filter((i) => i.severity === "error").length === 0, JSON.stringify(clean.issues));
t("clean rule → rule returned", clean.rule !== null);

if (failures) {
  console.error(`\n${failures} linter assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll linter assertions passed.");
