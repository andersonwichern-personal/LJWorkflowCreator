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

/** orderedEnum = enum whose options are ranked (best→worst), e.g. risk grades. */
export type FieldKind = "enum" | "text" | "numeric" | "orderedEnum";

/* -------------------------------------------------------------------------- */
/* Operators                                                                  */
/* -------------------------------------------------------------------------- */

/** Presence operators available on every kind (hardening plan §2.4 / C6). */
const EMPTY_OPS = [
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

/** Operators that take no value token (the value pill is hidden). */
export function isValuelessOperator(operator: string): boolean {
  return operator === "is_empty" || operator === "is_not_empty";
}

export const OPERATORS: Record<FieldKind, { value: string; label: string }[]> = {
  enum: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
    ...EMPTY_OPS,
  ],
  orderedEnum: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
    { value: "worse_than", label: "is worse than" },
    { value: "better_than", label: "is better than" },
    ...EMPTY_OPS,
  ],
  text: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
    { value: "contains", label: "contains" },
    ...EMPTY_OPS,
  ],
  numeric: [
    { value: "is", label: "is" },
    { value: "gt", label: "is greater than" },
    { value: "gte", label: "is at least" },
    { value: "lt", label: "is less than" },
    { value: "lte", label: "is at most" },
    ...EMPTY_OPS,
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

/** Group display order + icon (Lucide name) for the categorized picker. */
export const FIELD_GROUPS: { key: string; icon: string }[] = [
  { key: "Request", icon: "ClipboardList" },
  { key: "Customer", icon: "User" },
  { key: "Covenant", icon: "ShieldCheck" },
  { key: "Application Data", icon: "Wheat" },
  { key: "Underwriting", icon: "Scale" },
  { key: "Offer", icon: "Mail" },
  { key: "Booking", icon: "Landmark" },
  { key: "Loan", icon: "CreditCard" },
  { key: "Retailer & Program", icon: "Store" },
  { key: "Tags", icon: "Tag" },
  { key: "AI & Documents", icon: "Bot" },
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
  intake_path: {
    key: "intake_path",
    label: "intake path",
    kind: "enum",
    confidence: "verified",
    group: "Request",
    options: ["Intake Link", "Staff Wizard", "Blank Request"],
    hint: "How the request entered the system.",
  },
  template: {
    key: "template",
    label: "request template",
    kind: "text",
    confidence: "verified",
    group: "Request",
    hint: "The request template (workflows/templates) the request was created from.",
  },
  days_in_stage: {
    key: "days_in_stage",
    label: "days in stage",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "Request",
    hint: "Days the request has sat in its current stage — SLA-style trigger, not confirmed as tracked data.",
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
  customer_name: {
    key: "customer_name",
    label: "customer name",
    kind: "text",
    confidence: "verified",
    group: "Customer",
    hint: "A customer on the request (Customers section).",
  },
  aggregate_exposure: {
    key: "aggregate_exposure",
    label: "aggregate exposure",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "Customer",
    unit: "$",
    hint: "Total outstanding across the borrower AND every connected entity. Computed from the relationship graph, not a platform field.",
  },

  /* ---- Covenant (Phase 9 — SCHEDULED COVENANT REVIEW) ----
   * Registered ahead of their data source, exactly as reqtype/credit_score are
   * (ruleEngine.ts `fieldValue` returns UNKNOWN for them). Until the platform
   * supplies these, a condition on one resolves unknown and fails closed — it
   * never silently matches. Badged `unconfirmed` so the picker says so. */
  days_since_financials_pulled: {
    key: "days_since_financials_pulled",
    label: "days since financials pulled",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "Covenant",
    hint: "Age of the latest financials on file. No platform source yet — resolves unknown (fails closed).",
  },
  compliance_status: {
    key: "compliance_status",
    label: "compliance status",
    kind: "enum",
    confidence: "unconfirmed",
    group: "Covenant",
    options: ["Compliant", "Waived", "In Breach", "Pending Review"],
    hint: "Covenant compliance state. No platform source yet — resolves unknown (fails closed).",
  },
  covenant_type: {
    key: "covenant_type",
    label: "covenant type",
    kind: "enum",
    confidence: "unconfirmed",
    group: "Covenant",
    options: ["Financial", "Reporting", "Collateral", "Affirmative", "Negative"],
    hint: "Class of covenant under review. No platform source yet — resolves unknown (fails closed).",
  },

  /* ---- Application Data (per-template form fields — the real palette) ---- */
  loan_purpose: {
    key: "loan_purpose",
    label: "loan purpose",
    kind: "text",
    confidence: "unconfirmed",
    group: "Application Data",
    hint: "Loan Purpose form field — per-template; production binds by template + field ID.",
  },
  use_of_funds: {
    key: "use_of_funds",
    label: "use of funds",
    kind: "text",
    confidence: "unconfirmed",
    group: "Application Data",
    hint: "Use Of Funds form field — per-template; production binds by template + field ID.",
  },
  crop_type: {
    key: "crop_type",
    label: "crop type",
    kind: "text",
    confidence: "unconfirmed",
    group: "Application Data",
    hint: "Crop Details form field — per-template; production binds by template + field ID.",
  },
  livestock_type: {
    key: "livestock_type",
    label: "livestock type",
    kind: "text",
    confidence: "unconfirmed",
    group: "Application Data",
    hint: "Livestock form field — per-template; production binds by template + field ID.",
  },
  loan_source: {
    key: "loan_source",
    label: "loan source",
    kind: "text",
    confidence: "unconfirmed",
    group: "Application Data",
    hint: "Loan Sources form field — per-template; production binds by template + field ID.",
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
  risk_grade: {
    key: "risk_grade",
    label: "risk grade",
    kind: "orderedEnum", // options ranked best→worst; enables worse_than/better_than
    confidence: "verified",
    group: "Underwriting",
    options: ["A", "B", "C", "D", "E"],
    hint: "Underwriting risk grade — drives the approval authority matrix.",
  },
  dscr: {
    key: "dscr",
    label: "DSCR",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "Underwriting",
    hint: "Debt-service coverage ratio — may live only in documents/AI extraction, not structured data.",
  },
  ltv: {
    key: "ltv",
    label: "loan-to-value %",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "Underwriting",
    hint: "Loan-to-value ratio — not confirmed as structured data.",
  },
  collateral_value: {
    key: "collateral_value",
    label: "collateral value",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "Underwriting",
    unit: "$",
    hint: "Appraised collateral value — not confirmed as structured data.",
  },
  interest_rate: {
    key: "interest_rate",
    label: "interest rate %",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "Underwriting",
    hint: "Priced interest rate — not confirmed as a structured event condition.",
  },
  term_months: {
    key: "term_months",
    label: "term (months)",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "Underwriting",
    hint: "Loan term in months — not confirmed as a structured event condition.",
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
  offer_amount: {
    key: "offer_amount",
    label: "offer amount",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "Offer",
    unit: "$",
    hint: "Amount on the sent offer — Offers surface is client-mocked in test.",
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
  loan_balance: {
    key: "loan_balance",
    label: "loan balance",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "Loan",
    unit: "$",
    hint: "Outstanding balance on the booked loan — servicing data not confirmed.",
  },
  payment_status: {
    key: "payment_status",
    label: "payment status",
    kind: "enum",
    confidence: "unconfirmed",
    group: "Loan",
    options: ["Current", "Late", "Delinquent", "Paid Off"],
    hint: "Servicing payment state — values not confirmed against the platform.",
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
  doc_type: {
    key: "doc_type",
    label: "document type",
    kind: "text",
    confidence: "unconfirmed",
    group: "AI & Documents",
    hint: "File/checklist template the document belongs to (documents service).",
  },
  checklist_status: {
    key: "checklist_status",
    label: "checklist status",
    kind: "enum",
    confidence: "unconfirmed",
    group: "AI & Documents",
    options: ["Complete", "Incomplete"],
    hint: "Document checklist completion — values not confirmed.",
  },
  signature_status: {
    key: "signature_status",
    label: "signature status",
    kind: "enum",
    confidence: "unconfirmed",
    group: "AI & Documents",
    options: ["Pending", "Signed", "Declined"],
    hint: "Signature request state (signatures templates exist) — values not confirmed.",
  },
  extraction_confidence: {
    key: "extraction_confidence",
    label: "extraction confidence %",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "AI & Documents",
    hint: "AI document-extraction confidence — extraction templates exist; metric not confirmed.",
  },
  credit_score: {
    key: "credit_score",
    label: "credit score",
    kind: "numeric",
    confidence: "unconfirmed",
    group: "AI & Documents",
    hint: "FICO not confirmed as structured data — may live only in documents/AI extraction.",
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
  /**
   * Whether ID-bound live form-field refs (ff:<form>:<field>) are offerable on
   * this event — true only for the events that carry application data
   * (§3.1). Form fields survive a multi-trigger set iff EVERY trigger allows them.
   */
  allowsFormFields?: boolean;
}

/** Fields most lifecycle events can filter on. */
const COMMON = [
  "reqtype",
  "template",
  "intake_path",
  "custtype",
  "customer_name",
  "retailer",
  "program",
  "tags",
  "stage",
  "days_in_stage",
];

/** Per-template application form fields (Application Data group). */
const APP_DATA = ["loan_purpose", "use_of_funds", "crop_type", "livestock_type", "loan_source"];

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
    allowsFormFields: true,
    condFields: [
      "uwstatus",
      "queue",
      "loan_amount",
      "risk_grade",
      "credit_score",
      "dscr",
      "ltv",
      "collateral_value",
      "interest_rate",
      "term_months",
      "team_member",
      "main_borrower",
      ...APP_DATA,
      ...COMMON,
    ],
    blurb: "A loan reaches an approved underwriting outcome.",
  },
  {
    key: "LOAN REJECTED",
    label: "LOAN REJECTED",
    confidence: "verified",
    allowsFormFields: true,
    condFields: [
      "uwstatus",
      "queue",
      "loan_amount",
      "risk_grade",
      "credit_score",
      "dscr",
      "ltv",
      "collateral_value",
      "team_member",
      "main_borrower",
      ...APP_DATA,
      ...COMMON,
    ],
    blurb: "A loan is rejected in underwriting.",
  },
  {
    key: "OFFER ACCEPTED",
    label: "OFFER ACCEPTED",
    confidence: "verified",
    condFields: [
      "offer_queue",
      "offer_amount",
      "loan_amount",
      "risk_grade",
      "interest_rate",
      "term_months",
      "main_borrower",
      ...COMMON,
    ],
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
  /* Aspirational lifecycle triggers — gated. Not visible in the System Events log.
     Each maps to a real platform surface (documents / credit / offers / workflows
     services); whether the backend emits it is open question Q3 in the build manual. */
  {
    key: "REQUEST CREATED",
    label: "REQUEST CREATED",
    confidence: "unconfirmed",
    condFields: ["role", "main_borrower", ...COMMON],
    blurb: "Intake creates a request (stage Initiated) — not confirmed as an emitted event.",
  },
  {
    key: "REQUEST SUBMITTED",
    label: "REQUEST SUBMITTED",
    confidence: "unconfirmed",
    allowsFormFields: true,
    condFields: ["role", "main_borrower", ...APP_DATA, ...COMMON],
    blurb: "A borrower completes intake (Intake Link / Staff Wizard) — not confirmed as an emitted event.",
  },
  {
    key: "REQUEST STAGE CHANGED",
    label: "REQUEST STAGE CHANGED",
    confidence: "unconfirmed",
    condFields: ["team_member", "queue", ...COMMON],
    blurb: "A request enters a new lifecycle stage — the template stage spine; emit unconfirmed.",
  },
  {
    key: "REQUEST ASSIGNED",
    label: "REQUEST ASSIGNED",
    confidence: "unconfirmed",
    condFields: ["team_member", "queue", "loan_amount", ...COMMON],
    blurb: "A request is assigned to a person/team — not confirmed as an emitted event.",
  },
  {
    key: "CUSTOMER CREATED",
    label: "CUSTOMER CREATED",
    confidence: "unconfirmed",
    condFields: ["role", ...COMMON],
    blurb: "A customer (Business/Individual) is created — not confirmed as an emitted event.",
  },
  {
    key: "DOCUMENT UPLOADED",
    label: "DOCUMENT UPLOADED",
    confidence: "unconfirmed",
    condFields: ["doc_type", "doc_status", "checklist_status", "role", ...COMMON],
    blurb: "A document lands on the request — not confirmed as an emitted event.",
  },
  {
    key: "DOCUMENT APPROVED",
    label: "DOCUMENT APPROVED",
    confidence: "unconfirmed",
    condFields: ["doc_status", "doc_type", "checklist_status", "role", ...COMMON],
    blurb: "A document is approved in Documents Review — not confirmed as an emitted event.",
  },
  {
    key: "DOCUMENT REJECTED",
    label: "DOCUMENT REJECTED",
    confidence: "unconfirmed",
    condFields: ["doc_status", "doc_type", "role", ...COMMON],
    blurb: "A document is rejected in Documents Review — not confirmed as an emitted event.",
  },
  {
    key: "SIGNATURE COMPLETED",
    label: "SIGNATURE COMPLETED",
    confidence: "unconfirmed",
    condFields: ["signature_status", "doc_type", "role", ...COMMON],
    blurb: "A signature request is signed (signatures templates exist) — emit unconfirmed.",
  },
  {
    key: "CHECKLIST COMPLETED",
    label: "CHECKLIST COMPLETED",
    confidence: "unconfirmed",
    condFields: ["checklist_status", "doc_type", ...COMMON],
    blurb: "A document checklist reaches complete — not confirmed as an emitted event.",
  },
  {
    key: "EXTRACTION COMPLETED",
    label: "EXTRACTION COMPLETED",
    confidence: "unconfirmed",
    condFields: ["extraction_confidence", "doc_type", "credit_score", "dscr", ...COMMON],
    blurb: "AI document extraction finishes (extraction templates exist) — emit unconfirmed.",
  },
  {
    key: "CREDIT PULL COMPLETED",
    label: "CREDIT PULL COMPLETED",
    confidence: "unconfirmed",
    condFields: ["credit_score", "dscr", "risk_grade", "main_borrower", ...COMMON],
    blurb: "A credit pull returns (credit service exists) — not confirmed as an emitted event.",
  },
  {
    key: "OFFER MADE",
    label: "OFFER MADE",
    confidence: "unconfirmed",
    condFields: ["offer_queue", "offer_amount", "loan_amount", "interest_rate", "term_months", "main_borrower", ...COMMON],
    blurb: "Staff send an offer — not confirmed as an emitted event.",
  },
  {
    key: "OFFER REJECTED",
    label: "OFFER REJECTED",
    confidence: "unconfirmed",
    condFields: ["offer_queue", "offer_amount", "loan_amount", "main_borrower", ...COMMON],
    blurb: "A borrower declines an offer (Offers 'Rejected' queue exists) — emit unconfirmed.",
  },
  {
    key: "BOOKING STATUS CHANGED",
    label: "BOOKING STATUS CHANGED",
    confidence: "unconfirmed",
    condFields: ["bookstatus", "data_status", "processing_status", "core", "loan_product", "loan_amount", ...COMMON],
    blurb: "A booking event transitions status (Not Sent → … → Confirmed/Error) — emit unconfirmed.",
  },
  {
    key: "LOAN BOOKED",
    label: "LOAN BOOKED",
    confidence: "unconfirmed",
    condFields: ["loan_product", "loan_amount", "interest_rate", "term_months", "core", "loan_balance", ...COMMON],
    blurb: "A loan lands in the Loans (servicing) section — not confirmed as an emitted event.",
  },
  {
    key: "SCHEDULED COVENANT REVIEW",
    label: "SCHEDULED COVENANT REVIEW",
    confidence: "unconfirmed",
    condFields: [
      "days_since_financials_pulled",
      "compliance_status",
      "covenant_type",
      "aggregate_exposure",
      "loan_amount",
      "loan_balance",
      "risk_grade",
      "main_borrower",
      ...COMMON,
    ],
    // Unlike every event above, this one is a CLOCK tick, not a request state
    // change — so ruleEngine.ts `requestMatchesEvent` has nothing to derive it
    // from and returns false, and no worker/cron exists to fire it either. The
    // vocabulary + rule shape ship now so covenant rules are authorable and
    // storable; they stay inert until a scheduler exists. Says so on the pill.
    blurb:
      "A periodic covenant review comes due. NOT YET EMITTED — no scheduler exists in this prototype, so rules on this trigger save but never fire.",
  },
];

export function getEvent(key: string): EventDef | undefined {
  return EVENTS.find((e) => e.key === key);
}

/**
 * Attribute fields offerable across a SET of triggers (multi-trigger, §3.1):
 * the set-intersection of each event's `condFields`. A field is only offered if
 * EVERY selected trigger supports it, so a rule can never condition on a field
 * one of its triggers can't carry. Unknown events contribute nothing (the
 * validator flags them separately).
 */
export function allowedFieldsForTriggers(events: string[]): FieldDef[] {
  const known = events.map((e) => getEvent(e)).filter((d): d is EventDef => !!d);
  if (known.length === 0) return [];
  let keys = new Set(known[0].condFields);
  for (const d of known.slice(1)) {
    const s = new Set(d.condFields);
    keys = new Set([...keys].filter((k) => s.has(k)));
  }
  return [...keys].map((k) => FIELDS[k]).filter(Boolean);
}

/** Single-event wrapper (unchanged behavior). */
export function allowedFieldsForEvent(eventKey: string): FieldDef[] {
  return allowedFieldsForTriggers([eventKey]);
}

/** Are ID-bound live form fields offerable across ALL of these triggers? */
export function triggersAllowFormFields(events: string[]): boolean {
  const known = events.map((e) => getEvent(e)).filter((d): d is EventDef => !!d);
  return known.length > 0 && known.every((d) => d.allowsFormFields === true);
}

/* -------------------------------------------------------------------------- */
/* Actions — output vocabulary                                                */
/* -------------------------------------------------------------------------- */

export type ParamKind = "enum" | "text" | "none";

/**
 * Action-execution contract (alignment doc §6a): where an action actually
 * lands on the platform and whether it can run today. The UI surfaces this so
 * authors always know which effects are live vs pending — never let a gated
 * action imply it runs.
 */
export interface ActionExecution {
  /** The real platform sink (build manual §8). */
  sink: "novu" | "workflows" | "credit" | "documents" | "authority" | "none";
  status: "executable-now" | "backend-required" | "mocked-surface";
}

export interface ActionDef {
  key: string;
  label: string;
  confidence: Confidence;
  paramKind: ParamKind;
  paramLabel: string;
  /** For enum params, or as suggestions for text params. */
  paramOptions?: string[];
  blurb: string;
  execution: ActionExecution;
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
    execution: { sink: "workflows", status: "backend-required" },
  },
  {
    key: "change_stage",
    label: "change stage to",
    confidence: "verified",
    paramKind: "enum",
    paramLabel: "stage",
    paramOptions: ["Initiated", "Processing", "Approved", "Closed"],
    blurb: "Move the request to a lifecycle stage (Change Stage).",
    execution: { sink: "workflows", status: "backend-required" },
  },
  {
    key: "add_tag",
    label: "add tag",
    confidence: "verified",
    paramKind: "text",
    paramLabel: "tag",
    blurb: "Apply a tag to the request.",
    execution: { sink: "workflows", status: "backend-required" },
  },
  {
    key: "remove_tag",
    label: "remove tag",
    confidence: "verified",
    paramKind: "text",
    paramLabel: "tag",
    blurb: "Remove a tag from the request.",
    execution: { sink: "workflows", status: "backend-required" },
  },
  {
    key: "close_request",
    label: "close the request",
    confidence: "verified",
    paramKind: "none",
    paramLabel: "",
    blurb: "Close (abandon) the request.",
    execution: { sink: "workflows", status: "backend-required" },
  },
  {
    key: "route_to_queue",
    label: "route to queue",
    confidence: "verified",
    paramKind: "enum",
    paramLabel: "queue",
    paramOptions: ["Unassigned", "Assigned", "Auto Approved", "Approved", "Rejected"],
    blurb: "Move the request into an underwriting queue.",
    execution: { sink: "workflows", status: "backend-required" },
  },
  {
    key: "set_underwriting_result",
    label: "set underwriting result to",
    confidence: "verified",
    paramKind: "enum",
    paramLabel: "result",
    paramOptions: ["Auto Approved", "Approved", "Rejected"],
    blurb: "Record the underwriting decision (the platform's Auto Approved lane does this today).",
    execution: { sink: "workflows", status: "backend-required" },
  },
  {
    key: "assign_authority",
    label: "escalate to authority",
    confidence: "verified",
    paramKind: "enum",
    paramLabel: "authority level",
    paramOptions: ["Loan Officer", "Credit Committee"],
    blurb: "Route the request to a configured approval authority level (Amount + Risk Grade + Product matrix).",
    // The evaluator runs client-side today; a hard approval gate needs backend support.
    execution: { sink: "authority", status: "backend-required" },
  },
  {
    key: "request_signature",
    label: "request signature from",
    confidence: "verified",
    paramKind: "text",
    paramLabel: "signer role",
    blurb: "Request document signatures from a specific party.",
    execution: { sink: "documents", status: "backend-required" },
  },
  {
    key: "pull_credit",
    label: "pull credit",
    confidence: "verified",
    paramKind: "none",
    paramLabel: "",
    blurb: "Trigger a credit pull for the applicant.",
    execution: { sink: "credit", status: "backend-required" },
  },
  {
    key: "run_extraction",
    label: "run document extraction",
    confidence: "verified",
    paramKind: "none",
    paramLabel: "",
    blurb: "Execute AI-based document data extraction.",
    execution: { sink: "documents", status: "backend-required" },
  },
  {
    key: "request_document",
    label: "request document",
    confidence: "verified",
    paramKind: "text",
    paramLabel: "document type",
    blurb: "Ask the borrower to upload a document (file/checklist templates).",
    execution: { sink: "documents", status: "backend-required" },
  },
  {
    key: "assign_checklist",
    label: "assign checklist",
    confidence: "verified",
    paramKind: "text",
    paramLabel: "checklist name",
    blurb: "Attach a document checklist to the request.",
    execution: { sink: "documents", status: "backend-required" },
  },
  {
    key: "notify",
    label: "notify",
    confidence: "verified",
    paramKind: "text",
    paramLabel: "recipient",
    paramOptions: ASSIGNEES,
    blurb: "Send an in-app notification via the Novu inbox (already wired in the admin).",
    execution: { sink: "novu", status: "executable-now" },
  },
  /* Aspirational — gated. Backend emit/execute unconfirmed on 2026-07-14. */
  {
    key: "make_offer",
    label: "make an offer for",
    confidence: "unconfirmed",
    paramKind: "text",
    paramLabel: "product",
    blurb: "Auto-sending an offer isn't confirmed as executable (Offers surface is mocked in test).",
    execution: { sink: "workflows", status: "mocked-surface" },
  },
  {
    key: "trigger_booking",
    label: "send booking to",
    confidence: "unconfirmed",
    paramKind: "enum",
    paramLabel: "core system",
    paramOptions: ["FISERV LOAN", "FMAC LOAN"],
    blurb: "Transmit the booking to a core system — gated until backend emittability is confirmed.",
    execution: { sink: "credit", status: "backend-required" },
  },
  {
    key: "log_event",
    label: "log system event",
    confidence: "unconfirmed",
    paramKind: "text",
    paramLabel: "event note",
    blurb: "Write to the System Events log — that surface is client-mocked in test.",
    execution: { sink: "none", status: "mocked-surface" },
  },
  {
    key: "send_webhook",
    label: "send webhook to",
    confidence: "unconfirmed",
    paramKind: "text",
    paramLabel: "endpoint URL",
    blurb: "Webhook infrastructure not confirmed to exist.",
    execution: { sink: "none", status: "backend-required" },
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

/**
 * ID-bound condition operand (alignment doc §5a / build manual §9).
 *
 * Platform-native structured attributes (stage, loan_amount, risk_grade…)
 * stay keyed as plain strings — they map to first-class request attributes.
 * Form-derived fields carry the real {formTemplateId, fieldId} reference so
 * the eventual executor knows exactly what to read. Label/kind are snapshotted
 * at author time so a saved rule renders without live data.
 */
export interface FormFieldRef {
  kind: "formField";
  formTemplateId: string;
  fieldId: string;
  /** Stable machine key of the field (e.g. "newField3"). */
  key?: string;
  /** Display label snapshot from the live picker. */
  label?: string;
  /** FieldKind mapped from the live fieldType at author time. */
  fieldKind?: FieldKind;
}

export type ConditionFieldRef = string | FormFieldRef;

export function isFormFieldRef(f: ConditionFieldRef | undefined): f is FormFieldRef {
  return typeof f === "object" && f !== null && f.kind === "formField";
}

/** Stable string key for a condition field (attribute key or ff:<form>:<field>). */
export function condFieldKey(f: ConditionFieldRef): string {
  return isFormFieldRef(f) ? `ff:${f.formTemplateId}:${f.fieldId}` : f;
}

/** Display label for a condition field. */
export function condFieldLabel(f: ConditionFieldRef): string {
  if (isFormFieldRef(f)) return f.label ?? f.key ?? "form field";
  return FIELDS[f]?.label ?? f;
}

/** Effective FieldKind for a condition field (drives operators + input mode). */
export function condFieldKind(f: ConditionFieldRef): FieldKind {
  if (isFormFieldRef(f)) return f.fieldKind ?? "text";
  return FIELDS[f]?.kind ?? "text";
}

/** Static FieldDef for attribute refs (undefined for ID-bound form fields). */
export function condFieldDef(f: ConditionFieldRef): FieldDef | undefined {
  return isFormFieldRef(f) ? undefined : FIELDS[f];
}

/* -------------------------------------------------------------------------- */
/* ScopeRef — category vs instance (schema v3, Phase 2 / contract §1b)        */
/* -------------------------------------------------------------------------- */

/**
 * A structured entity reference for condition values and action params.
 * - `any`       — matches vacuously (trigger scopes, "field present" combos).
 * - `category`  — matches the request's category attribute (requestType,
 *                 custtype, global stage, pseudo-team).
 * - `instance`  — a specific platform record: `id` is the platform UUID (for
 *                 stages: `templateId:stageId`), `label` is a display snapshot.
 * A bare `string` remains the legacy/free-text form; the helpers below make
 * every consumer total so `[object Object]` can never render.
 */
export type ScopeRef =
  | { level: "any" }
  | { level: "category"; category: string }
  | { level: "instance"; id: string; label: string };

export type ScopeValue = string | ScopeRef;

export function isScopeRef(v: unknown): v is ScopeRef {
  if (typeof v !== "object" || v === null) return false;
  const s = v as ScopeRef;
  if (s.level === "any") return true;
  if (s.level === "category") return typeof (s as { category?: unknown }).category === "string";
  if (s.level === "instance")
    return typeof (s as { id?: unknown }).id === "string" && typeof (s as { label?: unknown }).label === "string";
  return false;
}

/** Legacy/free-text form? (type guard) */
export function isLegacyString(v: ScopeValue): v is string {
  return typeof v === "string";
}

/** Total display label — never renders "[object Object]". */
export function scopeLabel(v: ScopeValue | null | undefined): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (!isScopeRef(v)) return "";
  switch (v.level) {
    case "any": return "any";
    case "category": return v.category;
    case "instance": return v.label;
  }
}

/** Platform instance id, when the value is an instance ref. */
export function scopeInstanceId(v: ScopeValue | null | undefined): string | null {
  return v != null && isScopeRef(v) && v.level === "instance" ? v.id : null;
}

/* -------------------------------------------------------------------------- */
/* Scope allocations — which tokens support which levels (Phase 2 §4.2)       */
/* -------------------------------------------------------------------------- */

export interface ScopeSpec {
  /** Category chips offered in the "By type" section (static source). */
  categories: string[];
  /** Which live registry feeds the "Specific" section. */
  instanceSource: "templates" | "retailers" | "users" | "stages" | "authorities" | "customers" | null;
  /** Present when the instance level ships disabled (no live endpoint yet). */
  instancesDisabledHint?: string;
  /** Field key whose value carries the category attribute at evaluation time. */
  categoryAttribute?: string;
}

/** Condition fields that take scoped values. */
export const SCOPED_FIELDS: Record<string, ScopeSpec> = {
  template: {
    categories: ["Loan Application", "Origination", "Covenant"],
    instanceSource: "templates",
    categoryAttribute: "reqtype",
  },
  retailer: {
    categories: [],
    instanceSource: "retailers",
  },
  customer_name: {
    categories: ["Business", "Individual"],
    instanceSource: "customers",
    categoryAttribute: "custtype",
  },
  stage: {
    categories: ["Initiated", "Processing", "Approved", "Closed"],
    instanceSource: "stages",
    categoryAttribute: "stage",
  },
  team_member: {
    categories: ["Underwriting Team", "Booking Team", "Escalation Team", "Operations Team"],
    instanceSource: "users",
  },
};

/** Action params that take scoped values (keyed by action key). */
export const SCOPED_PARAMS: Record<string, ScopeSpec> = {
  assign_user: { categories: ["Underwriting Team", "Booking Team", "Escalation Team", "Operations Team"], instanceSource: "users" },
  notify: { categories: ["Underwriting Team", "Booking Team", "Escalation Team", "Operations Team"], instanceSource: "users" },
  change_stage: { categories: ["Initiated", "Processing", "Approved", "Closed"], instanceSource: "stages", categoryAttribute: "stage" },
  assign_authority: { categories: [], instanceSource: "authorities" },
};

export interface RuleCondition {
  field: ConditionFieldRef;
  operator: string;
  /** Legacy/free-text string, or a structured ScopeRef on instance-shaped fields. */
  value: ScopeValue;
}

export interface RuleOutput {
  action: string;
  params: Record<string, ScopeValue>;
  /** Optional per-action gate (same node type as the root conditions). Persisted;
   *  the evaluator ignores it until the executor honors it (Phase 4). */
  when?: ConditionGroup;
  /**
   * SLA action delay — minutes to wait before this action runs. Absent or 0 =
   * execute instantly; negative = before the anchor (the NL parser emits e.g.
   * -7200 for "7 days before"). Authorable via the timer control on the action
   * pill (Phase 9).
   *
   * STILL NOT EXECUTED. There is no worker or cron in the current host, so a
   * delay is persisted and shown, and then the
   * executor runs the action immediately. The UI must keep saying so — a banker
   * who sets "3 days" and is not told otherwise will assume it waits 3 days.
   */
  delayMinutes?: number;
  /** Failure policy for the executor (Phase 4). Default "retry". */
  onFailure?: "retry" | "skip" | "halt";
}

/* ---- SLA delays (Phase 9) — one parser for the picker and the NL parser ---- */

const MINUTES_PER: Record<string, number> = {
  minute: 1,
  hour: 60,
  day: 60 * 24,
  week: 60 * 24 * 7,
};

/** Unit aliases a human might type. Longest-first so "min" can't shadow "minute". */
const DELAY_UNIT_ALIASES: { alias: string; unit: string }[] = [
  { alias: "minutes", unit: "minute" },
  { alias: "minute", unit: "minute" },
  { alias: "mins", unit: "minute" },
  { alias: "min", unit: "minute" },
  { alias: "m", unit: "minute" },
  { alias: "hours", unit: "hour" },
  { alias: "hour", unit: "hour" },
  { alias: "hrs", unit: "hour" },
  { alias: "hr", unit: "hour" },
  { alias: "h", unit: "hour" },
  { alias: "days", unit: "day" },
  { alias: "day", unit: "day" },
  { alias: "d", unit: "day" },
  { alias: "weeks", unit: "week" },
  { alias: "week", unit: "week" },
  { alias: "w", unit: "week" },
];

/** Longest delay authorable — 90 days. Guards against a typo'd "5000 weeks". */
export const MAX_DELAY_MINUTES = 90 * 24 * 60;

/**
 * Parse a human delay ("2 hours", "3 days", "90", "1 week") into minutes.
 * A bare number means minutes. Returns null when the text isn't a delay, so
 * callers can surface an author-time error instead of silently storing 0 —
 * a delay that quietly becomes "immediately" is the dangerous failure here.
 */
export function parseDelay(text: string): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/.exec(s);
  if (!m) return null;
  const qty = Number(m[1]);
  if (!isFinite(qty) || qty < 0) return null;
  const raw = m[2];
  const unit = raw ? DELAY_UNIT_ALIASES.find((u) => u.alias === raw)?.unit : "minute";
  if (!unit) return null;
  const minutes = Math.round(qty * MINUTES_PER[unit]);
  if (minutes > MAX_DELAY_MINUTES) return null;
  return minutes;
}

/** Render minutes back as the shortest exact phrase ("4320" → "3 days"). */
export function formatDelay(minutes: number): string {
  if (!minutes) return "immediately";
  const abs = Math.abs(minutes);
  const suffix = minutes < 0 ? " before" : "";
  for (const unit of ["week", "day", "hour"]) {
    const size = MINUTES_PER[unit];
    if (abs >= size && abs % size === 0) {
      const n = abs / size;
      return `${n} ${unit}${n === 1 ? "" : "s"}${suffix}`;
    }
  }
  return `${abs} minute${abs === 1 ? "" : "s"}${suffix}`;
}

export type CondLogic = "AND" | "OR";

/* -------------------------------------------------------------------------- */
/* Conditions — recursive AND/OR groups (schema v3)                           */
/* -------------------------------------------------------------------------- */

/** A single comparison. Assignment-compatible with the legacy RuleCondition. */
export type ConditionLeaf = RuleCondition;

export interface ConditionGroup {
  logic: CondLogic;
  children: ConditionNode[];
}

export type ConditionNode = ConditionLeaf | ConditionGroup;

/** Type guard: a node is a group iff it carries a `children` array. */
export function isGroup(n: ConditionNode): n is ConditionGroup {
  return Array.isArray((n as ConditionGroup).children);
}

/** Recursively collect every leaf under a group (evaluators, linter, audit). */
export function walkLeaves(group: ConditionGroup): ConditionLeaf[] {
  const out: ConditionLeaf[] = [];
  for (const child of group.children) {
    if (isGroup(child)) out.push(...walkLeaves(child));
    else out.push(child);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Triggers                                                                   */
/* -------------------------------------------------------------------------- */

export interface TriggerRef {
  event: string; // EventDef.key
  /** Optional instance scope — e.g. only requests from one template (Phase 2).
   *  Only `any` (default, same as absent) and template `instance` ship now. */
  scope?: ScopeRef;
}

/* -------------------------------------------------------------------------- */
/* Controls — the safety rails that live inside the rule                      */
/* -------------------------------------------------------------------------- */

export interface RuleControls {
  mode: "shadow" | "armed";          // default "shadow" — observe before acting
  oncePerRequest: boolean;           // default true (T2 idempotency)
  maxFiresPerHour: number;           // default 25 (A2 circuit breaker)
  missingData: "no_match" | "alert"; // default "no_match" (C2)
  priority: number;                  // default 100; lower runs first (T4)
  abSplit?: {
    targetWorkflowId: string;
    weightPercent: number;
  };
}

export function defaultControls(): RuleControls {
  return { mode: "shadow", oncePerRequest: true, maxFiresPerHour: 25, missingData: "no_match", priority: 100 };
}

/**
 * Generation-scoped idempotency key for `controls.oncePerRequest`
 * (edge-cases doc §10a / Amendment 1). The dedupe key is
 * `(workflowId, requestId, generation)` — NOT `(workflowId, requestId)` — so a
 * request that is closed and later reopened (which bumps its generation) is
 * eligible to be automated on again; old firings stay in the audit log.
 * `generation` starts at 1. Phase 4's fire route reads the latest generation
 * before its duplicate check; this codifies the key shape now so that check is
 * written against the correct contract.
 */
export function oncePerRequestKey(workflowId: string, requestId: string, generation = 1): string {
  return `${workflowId}:${requestId}:${generation}`;
}

/* -------------------------------------------------------------------------- */
/* The rule (schema v3)                                                       */
/* -------------------------------------------------------------------------- */

export const RULE_SCHEMA_VERSION = 3;

export interface WorkflowRule {
  schemaVersion: number;             // 3
  triggers: TriggerRef[];            // ≥1; OR semantics across triggers
  conditions: ConditionGroup;        // root group; children may nest
  actions: RuleOutput[];
  else?: RuleOutput[];               // fires when triggers match but conditions don't
  controls: RuleControls;
}

/**
 * Does any condition leaf reference this field key? Lets a caller skip the cost
 * of resolving an expensive context field (aggregate_exposure hits the customer
 * graph) for the rules that never ask for it.
 */
export function ruleReferencesField(rule: WorkflowRule, fieldKey: string): boolean {
  return walkLeaves(rule.conditions).some((leaf) => condFieldKey(leaf.field) === fieldKey);
}

export function emptyRule(): WorkflowRule {
  return {
    schemaVersion: RULE_SCHEMA_VERSION,
    triggers: [{ event: EVENTS[0].key }],
    conditions: { logic: "AND", children: [] },
    actions: [],
    controls: defaultControls(),
  };
}

/* -------------------------------------------------------------------------- */
/* Normalization — v1 | v2 | v3 → v3 (idempotent)                             */
/* -------------------------------------------------------------------------- */

/** Structurally valid condition-field ref (attribute key or ID-bound form field)? */
function isValidFieldRef(f: unknown): f is ConditionFieldRef {
  if (typeof f === "string") return true;
  return (
    isFormFieldRef(f as ConditionFieldRef) &&
    !!(f as FormFieldRef).formTemplateId &&
    !!(f as FormFieldRef).fieldId
  );
}

/** Preserve well-formed ScopeRef objects; stringify everything else. */
function coerceValue(raw: unknown): ScopeValue {
  if (raw == null) return "";
  if (isScopeRef(raw)) return raw;
  if (typeof raw === "object") return ""; // malformed object — never "[object Object]"
  return String(raw);
}

function coerceLeaf(raw: Record<string, unknown>): ConditionLeaf | null {
  if (!isValidFieldRef(raw.field)) return null;
  return {
    field: raw.field as ConditionFieldRef,
    operator: typeof raw.operator === "string" ? raw.operator : "is",
    value: coerceValue(raw.value),
  };
}

/** Normalize a raw group node, recursing into sub-groups (depth preserved). */
function normalizeGroup(raw: unknown): ConditionGroup {
  const g = (raw ?? {}) as Record<string, unknown>;
  const logic: CondLogic = g.logic === "OR" ? "OR" : "AND";
  const childrenRaw = Array.isArray(g.children) ? g.children : [];
  const children: ConditionNode[] = [];
  for (const ch of childrenRaw) {
    const c = (ch ?? {}) as Record<string, unknown>;
    if (Array.isArray(c.children)) {
      children.push(normalizeGroup(c)); // recurse — never alters depth
    } else {
      const leaf = coerceLeaf(c);
      if (leaf) children.push(leaf); // malformed leaves are dropped
    }
  }
  return { logic, children };
}

/** Turn a flat v2 `conditions.rules[]` (or v1 `conds[]`) into a root group. */
function leavesToGroup(rulesRaw: unknown, logic: CondLogic): ConditionGroup {
  const arr = Array.isArray(rulesRaw) ? rulesRaw : [];
  const children: ConditionNode[] = [];
  for (const c0 of arr) {
    const leaf = coerceLeaf((c0 ?? {}) as Record<string, unknown>);
    if (leaf) children.push(leaf);
  }
  return { logic, children };
}

function normalizeActions(raw: unknown): RuleOutput[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: RuleOutput[] = [];
  for (const a0 of arr) {
    const a = (a0 ?? {}) as Record<string, unknown>;
    if (typeof a.action !== "string") continue;
    const paramsRaw = a.params && typeof a.params === "object" ? (a.params as Record<string, unknown>) : {};
    const params: Record<string, ScopeValue> = {};
    for (const [k, v] of Object.entries(paramsRaw)) params[k] = coerceValue(v);
    const action: RuleOutput = { action: a.action, params };
    if (a.when) action.when = normalizeGroup(a.when);
    if (typeof a.delayMinutes === "number") action.delayMinutes = a.delayMinutes;
    if (a.onFailure === "retry" || a.onFailure === "skip" || a.onFailure === "halt") action.onFailure = a.onFailure;
    out.push(action);
  }
  return out;
}

function coerceControls(raw: unknown): RuleControls {
  const d = defaultControls();
  const c = (raw ?? {}) as Record<string, unknown>;
  const ab =
    c.abSplit && typeof c.abSplit === "object"
      ? (c.abSplit as Record<string, unknown>)
      : null;
  return {
    mode: c.mode === "armed" ? "armed" : "shadow",
    oncePerRequest: typeof c.oncePerRequest === "boolean" ? c.oncePerRequest : d.oncePerRequest,
    maxFiresPerHour:
      typeof c.maxFiresPerHour === "number" && !Number.isNaN(c.maxFiresPerHour) ? c.maxFiresPerHour : d.maxFiresPerHour,
    missingData: c.missingData === "alert" ? "alert" : "no_match",
    priority: typeof c.priority === "number" && !Number.isNaN(c.priority) ? c.priority : d.priority,
    abSplit:
      ab && typeof ab.targetWorkflowId === "string" && typeof ab.weightPercent === "number" && !Number.isNaN(ab.weightPercent)
        ? {
            targetWorkflowId: ab.targetWorkflowId,
            weightPercent: Math.max(1, Math.min(99, Math.round(ab.weightPercent))),
          }
        : undefined,
  };
}

function triggersFrom(raw: unknown): TriggerRef[] {
  if (!Array.isArray(raw)) return [];
  const out: TriggerRef[] = [];
  for (const t0 of raw) {
    const t = (t0 ?? {}) as Record<string, unknown>;
    if (typeof t.event !== "string") continue;
    const trigger: TriggerRef = { event: t.event };
    if (isScopeRef(t.scope)) trigger.scope = t.scope; // malformed scopes dropped
    out.push(trigger);
  }
  return out;
}

/**
 * Coerce any persisted rule JSON — legacy v1, v2, or v3 — into a well-formed v3
 * WorkflowRule. Idempotent. Shape-only: never alters group depth or drops valid
 * nodes (depth policy belongs to the validator, §3.2). Empty/all-invalid triggers
 * are preserved so the validator can flag them. Safe on API results + builder state.
 */
export function normalizeRule(raw: unknown): WorkflowRule {
  const r = (raw ?? {}) as Record<string, unknown>;

  // v3 — has a triggers[] array.
  if (Array.isArray(r.triggers)) {
    const rule: WorkflowRule = {
      schemaVersion: RULE_SCHEMA_VERSION,
      triggers: triggersFrom(r.triggers),
      conditions: normalizeGroup(r.conditions),
      actions: normalizeActions(r.actions),
      controls: coerceControls(r.controls),
    };
    if (r.else !== undefined) rule.else = normalizeActions(r.else);
    return rule;
  }

  // v2 — nested trigger/conditions objects (conditions.rules is a flat list).
  const hasV2Nest =
    (r.trigger !== null && typeof r.trigger === "object") ||
    (r.conditions !== null && typeof r.conditions === "object");
  if (hasV2Nest) {
    const trigger = r.trigger as { event?: string } | undefined;
    const conditions = r.conditions as { logic?: string; rules?: unknown } | undefined;
    const event = typeof trigger?.event === "string" ? trigger.event : EVENTS[0].key;
    const logic: CondLogic = conditions?.logic === "OR" ? "OR" : "AND";
    return {
      schemaVersion: RULE_SCHEMA_VERSION,
      triggers: [{ event }],
      conditions: leavesToGroup(conditions?.rules, logic),
      actions: normalizeActions(r.actions),
      controls: defaultControls(),
    };
  }

  // v1 — legacy flat { event, conds, outputs, condLogic }.
  if (typeof r.event === "string" || Array.isArray(r.conds) || Array.isArray(r.outputs)) {
    const event = typeof r.event === "string" ? r.event : EVENTS[0].key;
    const logic: CondLogic = r.condLogic === "OR" ? "OR" : "AND";
    return {
      schemaVersion: RULE_SCHEMA_VERSION,
      triggers: [{ event }],
      conditions: leavesToGroup(r.conds, logic),
      actions: normalizeActions(r.outputs),
      controls: defaultControls(),
    };
  }

  // Unrecognizable → a safe empty v3 rule.
  return emptyRule();
}

export function ruleUsesUnconfirmed(rule: WorkflowRule): boolean {
  if (rule.triggers.some((t) => getEvent(t.event)?.confidence === "unconfirmed")) return true;
  // ID-bound form-field refs come from live platform data — treated as verified.
  if (walkLeaves(rule.conditions).some((c) => condFieldDef(c.field)?.confidence === "unconfirmed")) return true;
  const allActions = [...rule.actions, ...(rule.else ?? [])];
  if (allActions.some((o) => getAction(o.action)?.confidence === "unconfirmed")) return true;
  return false;
}

/** Default value for a freshly added condition on a field. */
export function defaultValueFor(field: FieldDef): string {
  if ((field.kind === "enum" || field.kind === "orderedEnum") && field.options?.length) {
    return field.options[0];
  }
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
    icon: "Siren",
    rule: {
      schemaVersion: RULE_SCHEMA_VERSION,
      triggers: [{ event: "SYSTEM ERROR" }],
      conditions: { logic: "AND", children: [{ field: "bookstatus", operator: "is", value: "Error" }] },
      actions: [{ action: "assign_user", params: { assignee: "Escalation Team" } }],
      controls: defaultControls(),
    },
  },
  {
    name: "Auto-assign approved loans",
    description: "Route freshly approved loans to the underwriting team.",
    icon: "CircleCheck",
    rule: {
      schemaVersion: RULE_SCHEMA_VERSION,
      triggers: [{ event: "LOAN APPROVED" }],
      conditions: { logic: "AND", children: [{ field: "uwstatus", operator: "is", value: "Approved" }] },
      actions: [{ action: "assign_user", params: { assignee: "Underwriting Team" } }],
      controls: defaultControls(),
    },
  },
  {
    name: "Large loan review",
    description: "Send high-value approvals to a senior reviewer.",
    icon: "Banknote",
    rule: {
      schemaVersion: RULE_SCHEMA_VERSION,
      triggers: [{ event: "LOAN APPROVED" }],
      conditions: { logic: "AND", children: [{ field: "loan_amount", operator: "gte", value: "250000" }] },
      actions: [{ action: "assign_user", params: { assignee: "Wael" } }],
      controls: defaultControls(),
    },
  },
  {
    name: "Fiserv booking failure",
    description: "Flag failed Fiserv bookings and tag them for follow-up.",
    icon: "Landmark",
    rule: {
      schemaVersion: RULE_SCHEMA_VERSION,
      triggers: [{ event: "FISERV LOAN" }],
      conditions: { logic: "AND", children: [{ field: "bookstatus", operator: "is", value: "Error" }] },
      actions: [
        { action: "assign_user", params: { assignee: "Booking Team" } },
        { action: "add_tag", params: { value: "booking-failed" } },
      ],
      controls: defaultControls(),
    },
  },
];

/** Back-compat: some modules import ASSIGN_PARAM_KEY. */
export const ASSIGN_PARAM_KEY = "assignee";
