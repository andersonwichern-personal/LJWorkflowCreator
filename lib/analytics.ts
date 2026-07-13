/**
 * Derived analytics for the Insights section. Pure functions over the seed
 * data — deterministic, no runtime clock.
 */

import { REQUESTS, RETAILERS, formatCurrency, PlatformRequest, BookStatus } from "./platformData";

export function totalPipelineVolume(): number {
  return REQUESTS.filter((r) => r.stage !== "Closed").reduce((s, r) => s + r.loanAmount, 0);
}

export function bookedVolume(): number {
  return REQUESTS.filter((r) => r.bookStatus === "Confirmed" || r.bookStatus === "Partially Confirmed").reduce(
    (s, r) => s + r.loanAmount,
    0
  );
}

export function avgLoanSize(): number {
  return Math.round(REQUESTS.reduce((s, r) => s + r.loanAmount, 0) / REQUESTS.length);
}

export function approvalRate(): number {
  const decided = REQUESTS.filter((r) => r.uwStatus !== "Pending");
  const approved = decided.filter((r) => r.uwStatus === "Approved" || r.uwStatus === "Auto Approved");
  return decided.length ? Math.round((approved.length / decided.length) * 100) : 0;
}

export function volumeByRetailer(): { label: string; value: number }[] {
  return RETAILERS.map((rt) => ({
    label: rt,
    value: REQUESTS.filter((r) => r.retailer === rt).reduce((s, r) => s + r.loanAmount, 0),
  })).sort((a, b) => b.value - a.value);
}

export function requestsByStage(): { label: string; value: number }[] {
  const order: PlatformRequest["stage"][] = ["Initiated", "Processing", "Approved", "Closed"];
  return order.map((st) => ({ label: st, value: REQUESTS.filter((r) => r.stage === st).length }));
}

/** Booking status distribution → status-colored segments (reserved status palette). */
export function bookingStatusBreakdown(): { label: string; value: number; tone: "green" | "amber" | "red" | "gray" | "blue" }[] {
  const toneFor: Record<BookStatus, "green" | "amber" | "red" | "gray" | "blue"> = {
    Confirmed: "green",
    "Partially Confirmed": "amber",
    Sent: "blue",
    "In Flight": "amber",
    Unconfirmed: "red",
    Error: "red",
    "Not Sent": "gray",
  };
  const counts = new Map<BookStatus, number>();
  for (const r of REQUESTS) counts.set(r.bookStatus, (counts.get(r.bookStatus) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value, tone: toneFor[label] }))
    .sort((a, b) => b.value - a.value);
}

/** Deterministic 6-month booked-volume trend (Feb–Jul 2026), in dollars. */
export function monthlyVolume(): { label: string; value: number }[] {
  return [
    { label: "Feb", value: 1_240_000 },
    { label: "Mar", value: 1_680_000 },
    { label: "Apr", value: 1_450_000 },
    { label: "May", value: 2_100_000 },
    { label: "Jun", value: 1_920_000 },
    { label: "Jul", value: 2_460_000 },
  ];
}

export { formatCurrency };
