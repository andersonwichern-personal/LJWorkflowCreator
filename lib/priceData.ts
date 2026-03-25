export type JobCategory =
  | "Roofing"
  | "HVAC"
  | "Plumbing"
  | "Electrical"
  | "Kitchen Remodel"
  | "Bathroom Remodel"
  | "Flooring"
  | "Painting (Interior)"
  | "Painting (Exterior)"
  | "Deck / Patio"
  | "Drywall"
  | "Windows"
  | "Landscaping"
  | "Foundation / Basement"
  | "Siding";

export interface PriceRange {
  low: number;
  high: number;
  unit: string;
  notes: string;
}

export const priceRanges: Record<JobCategory, PriceRange> = {
  Roofing: {
    low: 5500,
    high: 15000,
    unit: "per job (avg. home)",
    notes: "Asphalt shingles on a 1,500–2,000 sq ft roof. Metal or slate adds cost.",
  },
  HVAC: {
    low: 4000,
    high: 12000,
    unit: "per system replacement",
    notes: "Full central AC + furnace replacement. Repair jobs are $150–$900.",
  },
  Plumbing: {
    low: 175,
    high: 8500,
    unit: "varies by scope",
    notes: "Leak repair: $150–$400. Full re-pipe: $4,000–$8,500.",
  },
  Electrical: {
    low: 200,
    high: 10000,
    unit: "varies by scope",
    notes: "Panel upgrade: $1,500–$4,000. Full rewire: $6,000–$10,000.",
  },
  "Kitchen Remodel": {
    low: 15000,
    high: 75000,
    unit: "per project",
    notes: "Minor refresh: $15k. Mid-range: $30–45k. High-end: $60k+.",
  },
  "Bathroom Remodel": {
    low: 6000,
    high: 35000,
    unit: "per bathroom",
    notes: "Basic: $6–10k. Mid-range: $15–20k. Luxury: $25k+.",
  },
  Flooring: {
    low: 3,
    high: 22,
    unit: "per sq ft (installed)",
    notes: "Vinyl/laminate: $3–8/sqft. Hardwood: $8–16/sqft. Tile: $10–22/sqft.",
  },
  "Painting (Interior)": {
    low: 2,
    high: 6,
    unit: "per sq ft",
    notes: "Whole-house interior. Expect $1,800–$5,500 for an average home.",
  },
  "Painting (Exterior)": {
    low: 1,
    high: 4,
    unit: "per sq ft",
    notes: "Typical 1,500 sq ft home runs $1,500–$4,000.",
  },
  "Deck / Patio": {
    low: 4000,
    high: 22000,
    unit: "per project",
    notes: "Pressure-treated wood deck: $4–8k. Composite or large patio: up to $22k.",
  },
  Drywall: {
    low: 1.5,
    high: 3.5,
    unit: "per sq ft (installed)",
    notes: "Hanging + finishing + painting. A full room runs $900–$2,800.",
  },
  Windows: {
    low: 300,
    high: 1200,
    unit: "per window (installed)",
    notes: "Double-pane vinyl: $300–$600. Wood or specialty: up to $1,200 each.",
  },
  Landscaping: {
    low: 500,
    high: 10000,
    unit: "per project",
    notes: "Basic cleanup/mulch: $500. Full redesign with hardscape: up to $10k+.",
  },
  "Foundation / Basement": {
    low: 2500,
    high: 30000,
    unit: "per project",
    notes: "Crack repair: $250–$2,500. Full waterproofing/underpinning: $10–30k.",
  },
  Siding: {
    low: 5000,
    high: 20000,
    unit: "per home",
    notes: "Vinyl: $5–10k. Fiber cement: $8–16k. Wood: $12–20k.",
  },
};

export const JOB_CATEGORIES = Object.keys(priceRanges) as JobCategory[];

export type Verdict = "great" | "fair" | "high" | "very_high";

export function evaluateQuote(
  category: JobCategory,
  amount: number
): { verdict: Verdict; message: string; percentOfMidpoint: number } {
  const range = priceRanges[category];
  const midpoint = (range.low + range.high) / 2;
  const percentOfMidpoint = Math.round((amount / midpoint) * 100);

  let verdict: Verdict;
  let message: string;

  const ratio = amount / range.high;

  if (amount < range.low * 0.85) {
    verdict = "great";
    message = "This quote is well below the typical range — verify the scope is complete.";
  } else if (amount <= range.high * 1.05) {
    verdict = "fair";
    message = "This quote falls within the normal price range for this type of work.";
  } else if (amount <= range.high * 1.3) {
    verdict = "high";
    message = "This quote is above average. Consider getting a second opinion.";
  } else {
    verdict = "very_high";
    message = "This quote is significantly above market rate. Get multiple bids.";
  }

  return { verdict, message, percentOfMidpoint };
}
