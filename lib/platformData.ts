/**
 * Representative platform data for the standalone Workflow Creator demo.
 *
 * The real request/loan data lives in the Landjourney Angular app + backend
 * (BitBucket, access pending). These seed records mirror the *shape* and
 * *vocabulary* of the live admin console (Underwriting columns, Booking Events
 * statuses, System Events types, etc.) so the surrounding sections feel real and
 * give the Workflow Creator a believable context to automate over.
 *
 * All values are drawn from the verified vocabulary in `lib/vocabulary.ts`.
 * Dates are fixed strings (no runtime clock) so the demo is deterministic.
 */

export type Stage = "Initiated" | "Processing" | "Approved" | "Closed";
export type UwStatus = "Pending" | "Auto Approved" | "Approved" | "Rejected";
export type UwQueue =
  | "My Requests"
  | "Unassigned"
  | "Assigned"
  | "Auto Approved"
  | "Approved"
  | "Rejected";
export type BookStatus =
  | "Not Sent"
  | "In Flight"
  | "Sent"
  | "Confirmed"
  | "Partially Confirmed"
  | "Unconfirmed"
  | "Error";
export type Core = "FISERV LOAN" | "FMAC LOAN";
export type LoanProduct = "Term Loan" | "Line of Credit";
export type CustomerType = "Business" | "Individual";

export interface PlatformRequest {
  id: string;
  /** Request / deal name (usually the business or main borrower). */
  name: string;
  mainBorrower: string;
  customerType: CustomerType;
  retailer: string;
  program: string;
  loanAmount: number;
  loanProduct: LoanProduct;
  stage: Stage;
  uwStatus: UwStatus;
  uwQueue: UwQueue;
  offerQueue: "Unassigned" | "Assigned" | "Rejected" | null;
  bookStatus: BookStatus;
  core: Core;
  tags: string[];
  teamMember: string | null;
  dateSubmitted: string; // YYYY-MM-DD
}

export interface SystemEvent {
  id: string;
  type:
    | "SYSTEM ERROR"
    | "LOAN APPROVED"
    | "LOAN REJECTED"
    | "OFFER ACCEPTED"
    | "FISERV LOAN"
    | "FMAC LOAN";
  requestId: string;
  requestName: string;
  detail: string;
  timestamp: string; // YYYY-MM-DD HH:MM
}

export interface Customer {
  id: string;
  name: string;
  type: CustomerType;
  contact: string;
  email: string;
  openRequests: number;
  retailer: string;
}

/* -------------------------------------------------------------------------- */
/* Requests — the spine everything else is projected from                     */
/* -------------------------------------------------------------------------- */

export const REQUESTS: PlatformRequest[] = [
  {
    id: "REQ-4821",
    name: "Prairie Gold Farms LLC",
    mainBorrower: "Prairie Gold Farms LLC",
    customerType: "Business",
    retailer: "Growmark",
    program: "Term Ag Loan",
    loanAmount: 485000,
    loanProduct: "Term Loan",
    stage: "Approved",
    uwStatus: "Approved",
    uwQueue: "Approved",
    offerQueue: "Assigned",
    bookStatus: "Error",
    core: "FISERV LOAN",
    tags: ["priority", "large-loan"],
    teamMember: "Wael",
    dateSubmitted: "2026-07-09",
  },
  {
    id: "REQ-4820",
    name: "Hendricks Family Trust",
    mainBorrower: "Dale Hendricks",
    customerType: "Individual",
    retailer: "FCS Financial",
    program: "Real Estate Loan",
    loanAmount: 720000,
    loanProduct: "Term Loan",
    stage: "Approved",
    uwStatus: "Approved",
    uwQueue: "Approved",
    offerQueue: "Assigned",
    bookStatus: "Confirmed",
    core: "FMAC LOAN",
    tags: ["large-loan"],
    teamMember: "Sara",
    dateSubmitted: "2026-07-08",
  },
  {
    id: "REQ-4819",
    name: "Cornbelt Equipment Co",
    mainBorrower: "Cornbelt Equipment Co",
    customerType: "Business",
    retailer: "Heartland Co-op",
    program: "Equipment Finance",
    loanAmount: 156000,
    loanProduct: "Term Loan",
    stage: "Processing",
    uwStatus: "Pending",
    uwQueue: "Assigned",
    offerQueue: null,
    bookStatus: "Not Sent",
    core: "FISERV LOAN",
    tags: [],
    teamMember: "Mohammed",
    dateSubmitted: "2026-07-11",
  },
  {
    id: "REQ-4818",
    name: "Sunrise Dairy Partners",
    mainBorrower: "Ana Ruiz",
    customerType: "Business",
    retailer: "Growmark",
    program: "Operating Line",
    loanAmount: 240000,
    loanProduct: "Line of Credit",
    stage: "Processing",
    uwStatus: "Pending",
    uwQueue: "Unassigned",
    offerQueue: null,
    bookStatus: "Not Sent",
    core: "FISERV LOAN",
    tags: ["new-customer"],
    teamMember: null,
    dateSubmitted: "2026-07-12",
  },
  {
    id: "REQ-4817",
    name: "Willow Creek Ranch",
    mainBorrower: "Tom Beckett",
    customerType: "Individual",
    retailer: "AgriBank",
    program: "Term Ag Loan",
    loanAmount: 95000,
    loanProduct: "Term Loan",
    stage: "Approved",
    uwStatus: "Auto Approved",
    uwQueue: "Auto Approved",
    offerQueue: "Assigned",
    bookStatus: "Sent",
    core: "FMAC LOAN",
    tags: [],
    teamMember: "Aisha",
    dateSubmitted: "2026-07-10",
  },
  {
    id: "REQ-4816",
    name: "Northfield Grain Storage",
    mainBorrower: "Northfield Grain Storage",
    customerType: "Business",
    retailer: "FCS Financial",
    program: "Equipment Finance",
    loanAmount: 610000,
    loanProduct: "Term Loan",
    stage: "Approved",
    uwStatus: "Approved",
    uwQueue: "Approved",
    offerQueue: "Assigned",
    bookStatus: "In Flight",
    core: "FISERV LOAN",
    tags: ["large-loan", "priority"],
    teamMember: "Wael",
    dateSubmitted: "2026-07-07",
  },
  {
    id: "REQ-4815",
    name: "Two Rivers Orchard",
    mainBorrower: "Priya Nair",
    customerType: "Business",
    retailer: "Heartland Co-op",
    program: "Operating Line",
    loanAmount: 130000,
    loanProduct: "Line of Credit",
    stage: "Closed",
    uwStatus: "Rejected",
    uwQueue: "Rejected",
    offerQueue: "Rejected",
    bookStatus: "Not Sent",
    core: "FISERV LOAN",
    tags: ["declined"],
    teamMember: "Sara",
    dateSubmitted: "2026-07-05",
  },
  {
    id: "REQ-4814",
    name: "Maple Ridge Feedlot",
    mainBorrower: "Maple Ridge Feedlot",
    customerType: "Business",
    retailer: "Growmark",
    program: "Term Ag Loan",
    loanAmount: 340000,
    loanProduct: "Term Loan",
    stage: "Approved",
    uwStatus: "Approved",
    uwQueue: "Approved",
    offerQueue: "Assigned",
    bookStatus: "Partially Confirmed",
    core: "FMAC LOAN",
    tags: ["large-loan"],
    teamMember: "Omar",
    dateSubmitted: "2026-07-06",
  },
  {
    id: "REQ-4813",
    name: "Clearwater Irrigation",
    mainBorrower: "Grace Liu",
    customerType: "Business",
    retailer: "AgriBank",
    program: "Equipment Finance",
    loanAmount: 78000,
    loanProduct: "Term Loan",
    stage: "Initiated",
    uwStatus: "Pending",
    uwQueue: "Unassigned",
    offerQueue: null,
    bookStatus: "Not Sent",
    core: "FISERV LOAN",
    tags: ["new-customer"],
    teamMember: null,
    dateSubmitted: "2026-07-13",
  },
  {
    id: "REQ-4812",
    name: "Bluestem Cattle Co",
    mainBorrower: "Bluestem Cattle Co",
    customerType: "Business",
    retailer: "FCS Financial",
    program: "Operating Line",
    loanAmount: 205000,
    loanProduct: "Line of Credit",
    stage: "Processing",
    uwStatus: "Pending",
    uwQueue: "My Requests",
    offerQueue: null,
    bookStatus: "Not Sent",
    core: "FMAC LOAN",
    tags: [],
    teamMember: "Wael",
    dateSubmitted: "2026-07-11",
  },
  {
    id: "REQ-4811",
    name: "Harvest Moon Vineyards",
    mainBorrower: "Marco Silva",
    customerType: "Business",
    retailer: "Growmark",
    program: "Real Estate Loan",
    loanAmount: 950000,
    loanProduct: "Term Loan",
    stage: "Approved",
    uwStatus: "Approved",
    uwQueue: "Approved",
    offerQueue: "Assigned",
    bookStatus: "Confirmed",
    core: "FISERV LOAN",
    tags: ["large-loan", "priority"],
    teamMember: "Layla",
    dateSubmitted: "2026-07-04",
  },
  {
    id: "REQ-4810",
    name: "Silver Creek Poultry",
    mainBorrower: "Silver Creek Poultry",
    customerType: "Business",
    retailer: "Heartland Co-op",
    program: "Term Ag Loan",
    loanAmount: 167000,
    loanProduct: "Term Loan",
    stage: "Approved",
    uwStatus: "Approved",
    uwQueue: "Approved",
    offerQueue: "Assigned",
    bookStatus: "Unconfirmed",
    core: "FMAC LOAN",
    tags: [],
    teamMember: "Aisha",
    dateSubmitted: "2026-07-06",
  },
];

/* -------------------------------------------------------------------------- */
/* System Events log                                                          */
/* -------------------------------------------------------------------------- */

export const SYSTEM_EVENTS: SystemEvent[] = [
  { id: "EVT-9012", type: "SYSTEM ERROR", requestId: "REQ-4821", requestName: "Prairie Gold Farms LLC", detail: "Booking to Fiserv failed — core returned status Error.", timestamp: "2026-07-13 09:41" },
  { id: "EVT-9011", type: "LOAN APPROVED", requestId: "REQ-4816", requestName: "Northfield Grain Storage", detail: "Underwriting approved $610,000 term loan.", timestamp: "2026-07-13 09:12" },
  { id: "EVT-9010", type: "FMAC LOAN", requestId: "REQ-4810", requestName: "Silver Creek Poultry", detail: "Booking event sent to FMAC — awaiting confirmation.", timestamp: "2026-07-13 08:55" },
  { id: "EVT-9009", type: "OFFER ACCEPTED", requestId: "REQ-4811", requestName: "Harvest Moon Vineyards", detail: "Borrower accepted the offer for a $950,000 real estate loan.", timestamp: "2026-07-12 16:30" },
  { id: "EVT-9008", type: "LOAN APPROVED", requestId: "REQ-4811", requestName: "Harvest Moon Vineyards", detail: "Underwriting approved $950,000 real estate loan.", timestamp: "2026-07-12 15:02" },
  { id: "EVT-9007", type: "FISERV LOAN", requestId: "REQ-4811", requestName: "Harvest Moon Vineyards", detail: "Booking confirmed by Fiserv core.", timestamp: "2026-07-12 15:20" },
  { id: "EVT-9006", type: "FMAC LOAN", requestId: "REQ-4814", requestName: "Maple Ridge Feedlot", detail: "Booking partially confirmed by FMAC (1 of 2 tranches).", timestamp: "2026-07-12 11:47" },
  { id: "EVT-9005", type: "LOAN REJECTED", requestId: "REQ-4815", requestName: "Two Rivers Orchard", detail: "Underwriting rejected — insufficient collateral coverage.", timestamp: "2026-07-11 14:18" },
  { id: "EVT-9004", type: "OFFER ACCEPTED", requestId: "REQ-4820", requestName: "Hendricks Family Trust", detail: "Borrower accepted the offer for a $720,000 real estate loan.", timestamp: "2026-07-11 10:05" },
  { id: "EVT-9003", type: "FISERV LOAN", requestId: "REQ-4817", requestName: "Willow Creek Ranch", detail: "Booking event sent to Fiserv core.", timestamp: "2026-07-10 13:33" },
  { id: "EVT-9002", type: "LOAN APPROVED", requestId: "REQ-4817", requestName: "Willow Creek Ranch", detail: "Auto-approved $95,000 term loan.", timestamp: "2026-07-10 13:20" },
  { id: "EVT-9001", type: "FMAC LOAN", requestId: "REQ-4820", requestName: "Hendricks Family Trust", detail: "Booking confirmed by FMAC core.", timestamp: "2026-07-09 09:10" },
];

/* -------------------------------------------------------------------------- */
/* Customers                                                                  */
/* -------------------------------------------------------------------------- */

export const CUSTOMERS: Customer[] = [
  { id: "CUST-201", name: "Prairie Gold Farms LLC", type: "Business", contact: "Janet Powell", email: "janet@prairiegold.example", openRequests: 1, retailer: "Growmark" },
  { id: "CUST-202", name: "Hendricks Family Trust", type: "Individual", contact: "Dale Hendricks", email: "dale.h@example.com", openRequests: 1, retailer: "FCS Financial" },
  { id: "CUST-203", name: "Cornbelt Equipment Co", type: "Business", contact: "Rick Alvarez", email: "rick@cornbelt.example", openRequests: 2, retailer: "Heartland Co-op" },
  { id: "CUST-204", name: "Sunrise Dairy Partners", type: "Business", contact: "Ana Ruiz", email: "ana@sunrisedairy.example", openRequests: 1, retailer: "Growmark" },
  { id: "CUST-205", name: "Willow Creek Ranch", type: "Individual", contact: "Tom Beckett", email: "tom.beckett@example.com", openRequests: 1, retailer: "AgriBank" },
  { id: "CUST-206", name: "Harvest Moon Vineyards", type: "Business", contact: "Marco Silva", email: "marco@harvestmoon.example", openRequests: 1, retailer: "Growmark" },
];

/* -------------------------------------------------------------------------- */
/* Derived selectors                                                          */
/* -------------------------------------------------------------------------- */

export function formatCurrency(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

/** Loans (Service stage): confirmed/partially-confirmed bookings. */
export function bookedLoans(): PlatformRequest[] {
  return REQUESTS.filter(
    (r) => r.bookStatus === "Confirmed" || r.bookStatus === "Partially Confirmed"
  );
}

/** Offers currently in a queue. */
export function offers(): PlatformRequest[] {
  return REQUESTS.filter((r) => r.offerQueue !== null);
}

/** Booking events (anything that has left "Not Sent"). */
export function bookingEvents(): PlatformRequest[] {
  return REQUESTS.filter((r) => r.bookStatus !== "Not Sent");
}

/** Count of requests in each stage, for the Home pipeline. */
export function stageCounts(): Record<Stage, number> {
  const acc: Record<Stage, number> = { Initiated: 0, Processing: 0, Approved: 0, Closed: 0 };
  for (const r of REQUESTS) acc[r.stage]++;
  return acc;
}

export const RETAILERS = ["Growmark", "FCS Financial", "Heartland Co-op", "AgriBank"];
export const PROGRAMS = ["Term Ag Loan", "Equipment Finance", "Operating Line", "Real Estate Loan"];
