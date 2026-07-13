/**
 * Landjourney vocabulary for the Workflow Creator.
 *
 * Sourced from the landjourney-knowledge skill (the end-to-end lifecycle:
 * Configure → Intake → Collect → Review → Offer → Underwrite → Book → Service)
 * and grounded against the live admin site per Section 4 of the Foundation Brief.
 *
 *   confidence: "verified"    → observed in the real UI/data on 2026-07-13.
 *   confidence: "unconfirmed" → plausible from the platform model but not proven;
 *                               badged in the picker so the demo never offers a
 *                               trigger/action the backend can't emit or execute.
 *
 * This module is the single source of truth for the P1 "spine": the selected
 * event dynamically constrains which condition fields are offered.
 */

export type Confidence = "verified" | "unconfirmed";

export type FieldKind = "enum" | "text" | "numeric";

/* -------------------------------------------------------------------------- */
/* Operators                                                                  */
/* -------------------------------------------------------------------------- */

export const OPERATORS: Record<FieldKind, { value: string; label: string }[]> = {
  enum: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
  ],
  text: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
    { value: "contains", label: "contains" },
  ],
  numeric: [
    { value: "is", label: "is" },
    { value: "gt", label: "is greater than" },
    { value: "gte", label: "is at least" },
    { value: "lt", label: "is less than" },
    { value: "lte", label: "is at most" },
  ],
};

export function opLabel(kind: FieldKind, operator: string): string {
  return OPERATORS[kind].find((o) => o.value === operator)?.label ?? operator;
}

/* -------------------------------------------------------------------------- */
/* Fields — condition vocabulary, grouped by lifecycle area                   */
/* -------------------------------------------------------------------------- */

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  confidence: Confidence;
  /** Lifecycle group, used to categorize the picker. */
  group: string;
  options?: string[];
  /** Prefix unit for numeric display, e.g. "$". */
  unit?: string;
  hint?: string;
}

/** Group display order + icon for the categorized picker. */
export const FIELD_GROUPS: { key: string; icon: string }[] = [
  { key: "Request", icon: "📋" },
  { key: "Customer", icon: "👤" },
  { key: "Underwriting", icon: "⚖️" },
  { key: "Offer", icon: "✉️" },
  { key: "Booking", icon: "🏦" },
  { key: "Loan", icon: "💳" },
  { key: "Retailer & Program", icon: "🏬" },
  { key: "Tags", icon: "🔖" },
  { key: "AI & Documents", icon: "🤖" },
];

export const FIELDS: Record<string, FieldDef> = {
  /* ---- Request ---- */
  stage: {
    key: "stage",
    label: "request stage",
    kind: "enum",
    confidence: "verified",
    group: "Request",
    options: ["Initiated", "Processing", "Approved", "Closed"],
    hint: "Lifecycle stage (Change Stage on the request).",
  },
  reqtype: {
    key: "reqtype",
    label: "request type",
    kind: "enum",
    confidence: "verified",
    group: "Request",
    options: ["Loan Application", "Origination", "Covenant"],
    hint: "Template type the request was created from.",
  },

  /* ---- Customer ---- */
  custtype: {
    key: "custtype",
    label: "customer type",
    kind: "enum",
    confidence: "verified",
    group: "Customer",
    options: ["Business", "Individual"],
    hint: "Customers split into Businesses and Individuals.",
  },
  role: {
    key: "role",
    label: "customer role",
    kind: "enum",
    confidence: "verified",
    group: "Customer",
    options: ["Borrower", "Guarantor", "Co-Applicant"],
    hint: "Role a customer holds on the request.",
  },
  main_borrower: {
    key: "main_borrower",
    label: "main borrower",
    kind: "text",
    confidence: "verified",
    group: "Customer",
    hint: "Main borrower (an Underwriting column).",
  },

  /* ---- Underwriting ---- */
  queue: {
    key: "queue",
    label: "underwriting queue",
    kind: "enum",
    confidence: "verified",
    group: "Underwriting",
    options: [
      "My Requests",
      "Unassigned",
      "Assigned",
      "Auto Approved",
      "Approved",
      "Rejected",
      "All Requests",
    ],
    hint: "Which underwriting queue the request sits in.",
  },
  uwstatus: {
    key: "uwstatus",
    label: "underwriting result",
    kind: "enum",
    confidence: "verified",
    group: "Underwriting",
    options: ["Auto Approved", "Approved", "Rejected"],
    hint: "Underwriting decision.",
  },
  loan_amount: {
    key: "loan_amount",
    label: "loan amount",
    kind: "numeric",
    confidence: "verified",
    group: "Underwriting",
    unit: "$",
    hint: "Loan amount (an Underwriting column).",
  },
  team_member: {
    key: "team_member",
    label: "team member",
    kind: "text",
    confidence: "verified",
    group: "Underwriting",
    options: undefined, // suggestions injected below
    hint: "Assigned team member (an Underwriting column).",
  },

  /* ---- Offer ---- */
  offer_queue: {
    key: "offer_queue",
    label: "offer queue",
    kind: "enum",
    confidence: "verified",
    group: "Offer",
    options: ["Unassigned", "Assigned", "All", "Rejected"],
    hint: "Offers queue the request is in.",
  },

  /* ---- Booking ---- */
  bookstatus: {
    key: "bookstatus",
    label: "booking status",
    kind: "enum",
    confidence: "verified",
    group: "Booking",
    options: [
      "Not Sent",
      "In Flight",
      "Sent",
      "Confirmed",
      "Partially Confirmed",
      "Unconfirmed",
      "Error",
    ],
    hint: "Booking Events status transmitted to the core system.",
  },
  core: {
    key: "core",
    label: "core system",
    kind: "enum",
    confidence: "verified",
    group: "Booking",
    options: ["FISERV LOAN", "FMAC LOAN"],
    hint: "Destination core banking system.",
  },
  data_status: {
    key: "data_status",
    label: "data status",
    kind: "enum",
    confidence: "unconfirmed",
    group: "Booking",
    options: ["Complete", "Incomplete", "Error"],
    hint: "Booking Events 'Data Status' dimension exists; its exact values aren't confirmed.",
  },
  processing_status: {
    key: "processing_status",
    label: "processing status",
    kind: "enum",
    confidence: "unconfirmed",
    group: "Booking",
    options: ["Queued", "Processing", "Done", "Error"],
    hint: "Booking Events 'Processing Status' dimension exists; its exact values aren't confirmed.",
  },

  /* ---- Loan (Service) ---- */
  loan_product: {
    key: "loan_product",
    label: "loan product",
    kind: "enum",
    confidence: "verified",
    group: "Loan",
    options: ["Term Loan", "Line of Credit"],
    hint: "Booked loans tab: Term Loans / Lines of Credit.",
  },

  /* ---- Retailer & Program ---- */
  retailer: {
    key: "retailer",
    label: "retailer",
    kind: "text",
    confidence: "verified",
    group: "Retailer & Program",
    hint: "Retailer configured under Settings → Retailers.",
  },
  program: {
    key: "program",
    label: "program",
    kind: "text",
    confidence: "verified",
    group: "Retailer & Program",
    hint: "Program (part of the 'Retailer & Program' column).",
  },

  /* ---- Tags ---- */
  tags: {
    key: "tags",
    label: "tag",
    kind: "text",
    confidence: "verified",
    group: "Tags",
    hint: "A tag applied to the request (filterable in Underwriting).",
  },

  /* ---- AI & Documents (aspirational — gated) ---- */
  doc_status: {
    key: "doc_status",
    label: "document status",
    kind: "enum",
    confidence: "unconfirmed",
    group: "AI & Documents",
    options: ["Approved", "Rejected", "Skipped"],
    hint: "Documents Review approve/reject/skip — not confirmed as an emittable event condition.",
  },
  credit_score: {
    key: "credit_score",
    label: "credit score",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "AI & Documents",
    hint: "FICO/DSCR not confirmed as structured data — may live only in documents/AI extraction.",
  },
};

/* -------------------------------------------------------------------------- */
/* Assignees (demo)                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Demo people + teams. Real Settings → Users is a flat 43-person list (no roles
 * or authority hierarchy), so we assign to a named person/team — never the
 * fabricated `assign_authority` ladder.
 */
export const ASSIGNEES = [
  "Wael",
  "Sara",
  "Mohammed",
  "Aisha",
  "Omar",
  "Layla",
  "Underwriting Team",
  "Booking Team",
  "Escalation Team",
  "Operations Team",
];

// Team member field offers the same suggestions (but allows free text).
FIELDS.team_member.options = ASSIGNEES;

/* -------------------------------------------------------------------------- */
/* Events — trigger vocabulary + P1 condition binding                         */
/* -------------------------------------------------------------------------- */

export interface EventDef {
  key: string;
  label: string;
  confidence: Confidence;
  /** Field keys this event may constrain on (the P1 binding). */
  condFields: string[];
  blurb: string;
}

/** Fields most lifecycle events can filter on. */
const COMMON = ["reqtype", "custtype", "retailer", "program", "tags", "stage"];

export const EVENTS: EventDef[] = [
  {
    key: "SYSTEM ERROR",
    label: "SYSTEM ERROR",
    confidence: "verified",
    condFields: ["bookstatus", "data_status", "processing_status", "core", ...COMMON],
    blurb: "A system/booking error fires — the real hook for the booking-error → escalate demo.",
  },
  {
    key: "LOAN APPROVED",
    label: "LOAN APPROVED",
    confidence: "verified",
    condFields: [
      "uwstatus",
      "queue",
      "loan_amount",
      "team_member",
      "main_borrower",
      ...COMMON,
    ],
    blurb: "A loan reaches an approved underwriting outcome.",
  },
  {
    key: "LOAN REJECTED",
    label: "LOAN REJECTED",
    confidence: "verified",
    condFields: ["uwstatus", "queue", "loan_amount", "team_member", "main_borrower", ...COMMON],
    blurb: "A loan is rejected in underwriting.",
  },
  {
    key: "OFFER ACCEPTED",
    label: "OFFER ACCEPTED",
    confidence: "verified",
    condFields: ["offer_queue", "loan_amount", "main_borrower", ...COMMON],
    blurb: "A borrower accepts a sent offer.",
  },
  {
    key: "FISERV LOAN",
    label: "FISERV LOAN",
    confidence: "verified",
    condFields: [
      "bookstatus",
      "data_status",
      "processing_status",
      "core",
      "loan_product",
      "loan_amount",
      ...COMMON,
    ],
    blurb: "A booking event targeting the Fiserv core system.",
  },
  {
    key: "FMAC LOAN",
    label: "FMAC LOAN",
    confidence: "verified",
    condFields: [
      "bookstatus",
      "data_status",
      "processing_status",
      "core",
      "loan_product",
      "loan_amount",
      ...COMMON,
    ],
    blurb: "A booking event targeting the FMAC core system.",
  },
  /* Aspirational lifecycle triggers — gated. Not visible in the System Events log. */
  {
    key: "REQUEST CREATED",
    label: "REQUEST CREATED",
    confidence: "unconfirmed",
    condFields: ["role", "main_borrower", ...COMMON],
    blurb: "Intake creates a request (stage Initiated) — not confirmed as an emitted event.",
  },
  {
    key: "OFFER MADE",
    label: "OFFER MADE",
    confidence: "unconfirmed",
    condFields: ["offer_queue", "loan_amount", "main_borrower", ...COMMON],
    blurb: "Staff send an offer — not confirmed as an emitted event.",
  },
  {
    key: "DOCUMENT APPROVED",
    label: "DOCUMENT APPROVED",
    confidence: "unconfirmed",
    condFields: ["doc_status", "role", ...COMMON],
    blurb: "A document is approved in Documents Review — not confirmed as an emitted event.",
  },
];

export function getEvent(key: string): EventDef | undefined {
  return EVENTS.find((e) => e.key === key);
}

export function allowedFieldsForEvent(eventKey: string): FieldDef[] {
  const ev = getEvent(eventKey);
  if (!ev) return [];
  return ev.condFields.map((k) => FIELDS[k]).filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Actions — output vocabulary                                                */
/* -------------------------------------------------------------------------- */

export type ParamKind = "enum" | "text" | "none";

export interface ActionDef {
  key: string;
  label: string;
  confidence: Confidence;
  paramKind: ParamKind;
  paramLabel: string;
  /** For enum params, or as suggestions for text params. */
  paramOptions?: string[];
  blurb: string;
}

export const ACTIONS: ActionDef[] = [
  {
    key: "assign_user",
    label: "assign to",
    confidence: "verified",
    paramKind: "text",
    paramLabel: "assignee",
    paramOptions: ASSIGNEES,
    blurb: "Assign the request to a named person or team.",
  },
  {
    key: "change_stage",
    label: "change stage to",
    confidence: "verified",
    paramKind: "enum",
    paramLabel: "stage",
    paramOptions: ["Initiated", "Processing", "Approved", "Closed"],
    blurb: "Move the request to a lifecycle stage (Change Stage).",
  },
  {
    key: "add_tag",
    label: "add tag",
    confidence: "verified",
    paramKind: "text",
    paramLabel: "tag",
    blurb: "Apply a tag to the request.",
  },
  {
    key: "close_request",
    label: "close the request",
    confidence: "verified",
    paramKind: "none",
    paramLabel: "",
    blurb: "Close (abandon) the request.",
  },
  /* Aspirational — gated. Backend emit/execute unconfirmed on 2026-07-13. */
  {
    key: "make_offer",
    label: "make an offer for",
    confidence: "unconfirmed",
    paramKind: "text",
    paramLabel: "product",
    blurb: "Auto-sending an offer isn't confirmed as an executable action.",
  },
  {
    key: "notify",
    label: "notify",
    confidence: "unconfirmed",
    paramKind: "text",
    paramLabel: "recipient",
    paramOptions: ASSIGNEES,
    blurb: "In-app/email notification channel not confirmed.",
  },
  {
    key: "send_webhook",
    label: "send webhook to",
    confidence: "unconfirmed",
    paramKind: "text",
    paramLabel: "endpoint URL",
    blurb: "Webhook infrastructure not confirmed to exist.",
  },
  {
    key: "assign_authority",
    label: "escalate to authority",
    confidence: "unconfirmed",
    paramKind: "enum",
    paramLabel: "authority level",
    paramOptions: ["Loan Officer", "Loan Committee"],
    blurb: "FABRICATED in the mockup — no Roles/Permissions ladder exists. Use assign to instead.",
  },
];

export function getAction(key: string): ActionDef | undefined {
  return ACTIONS.find((a) => a.key === key);
}

/** Single JSON key each action stores its parameter under. */
export function paramKeyFor(actionKey: string): string {
  return actionKey === "assign_user" ? "assignee" : "value";
}

/* -------------------------------------------------------------------------- */
/* Rule shape — extends the { event, conds[], outputs[] } backend contract    */
/* -------------------------------------------------------------------------- */

export interface RuleCondition {
  field: string;
  operator: string;
  value: string;
}

export interface RuleOutput {
  action: string;
  params: Record<string, string>;
}

export type CondLogic = "AND" | "OR";

export interface WorkflowRule {
  event: string;
  conds: RuleCondition[];
  outputs: RuleOutput[];
  condLogic: CondLogic;
}

export function emptyRule(): WorkflowRule {
  return { event: EVENTS[0].key, conds: [], outputs: [], condLogic: "AND" };
}

export function ruleUsesUnconfirmed(rule: WorkflowRule): boolean {
  if (getEvent(rule.event)?.confidence === "unconfirmed") return true;
  if (rule.conds.some((c) => FIELDS[c.field]?.confidence === "unconfirmed")) return true;
  if (rule.outputs.some((o) => getAction(o.action)?.confidence === "unconfirmed")) return true;
  return false;
}

/** Default value for a freshly added condition on a field. */
export function defaultValueFor(field: FieldDef): string {
  if (field.kind === "enum" && field.options?.length) return field.options[0];
  return "";
}

/** Default param value for a freshly added action. */
export function defaultParamFor(action: ActionDef): Record<string, string> {
  if (action.paramKind === "none") return {};
  const first = action.paramOptions?.[0] ?? "";
  return { [paramKeyFor(action.key)]: first };
}

/* -------------------------------------------------------------------------- */
/* Starter templates — quick-start rules for the demo                         */
/* -------------------------------------------------------------------------- */

export interface StarterTemplate {
  name: string;
  description: string;
  icon: string;
  rule: WorkflowRule;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: "Booking error → escalate",
    description: "When a booking hits an error, hand it to the escalation team.",
    icon: "🚨",
    rule: {
      event: "SYSTEM ERROR",
      conds: [{ field: "bookstatus", operator: "is", value: "Error" }],
      outputs: [{ action: "assign_user", params: { assignee: "Escalation Team" } }],
      condLogic: "AND",
    },
  },
  {
    name: "Auto-assign approved loans",
    description: "Route freshly approved loans to the underwriting team.",
    icon: "✅",
    rule: {
      event: "LOAN APPROVED",
      conds: [{ field: "uwstatus", operator: "is", value: "Approved" }],
      outputs: [{ action: "assign_user", params: { assignee: "Underwriting Team" } }],
      condLogic: "AND",
    },
  },
  {
    name: "Large loan review",
    description: "Send high-value approvals to a senior reviewer.",
    icon: "💰",
    rule: {
      event: "LOAN APPROVED",
      conds: [{ field: "loan_amount", operator: "gte", value: "250000" }],
      outputs: [{ action: "assign_user", params: { assignee: "Wael" } }],
      condLogic: "AND",
    },
  },
  {
    name: "Fiserv booking failure",
    description: "Flag failed Fiserv bookings and tag them for follow-up.",
    icon: "🏦",
    rule: {
      event: "FISERV LOAN",
      conds: [{ field: "bookstatus", operator: "is", value: "Error" }],
      outputs: [
        { action: "assign_user", params: { assignee: "Booking Team" } },
        { action: "add_tag", params: { value: "booking-failed" } },
      ],
      condLogic: "AND",
    },
  },
];

/** Back-compat: some modules import ASSIGN_PARAM_KEY. */
export const ASSIGN_PARAM_KEY = "assignee";
