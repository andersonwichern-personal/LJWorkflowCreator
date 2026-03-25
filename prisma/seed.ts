import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!connectionString) throw new Error("DATABASE_URL or DIRECT_URL must be set in .env.local");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const seedData = [
  {
    category: "Roofing",
    low: 5500,
    high: 15000,
    unit: "per job (avg. home)",
    notes: "Asphalt shingles on a 1,500–2,000 sq ft roof. Metal or slate adds cost.",
  },
  {
    category: "HVAC",
    low: 4000,
    high: 12000,
    unit: "per system replacement",
    notes: "Full central AC + furnace replacement. Repair jobs are $150–$900.",
  },
  {
    category: "Plumbing",
    low: 175,
    high: 8500,
    unit: "varies by scope",
    notes: "Leak repair: $150–$400. Full re-pipe: $4,000–$8,500.",
  },
  {
    category: "Electrical",
    low: 200,
    high: 10000,
    unit: "varies by scope",
    notes: "Panel upgrade: $1,500–$4,000. Full rewire: $6,000–$10,000.",
  },
  {
    category: "Kitchen Remodel",
    low: 15000,
    high: 75000,
    unit: "per project",
    notes: "Minor refresh: $15k. Mid-range: $30–45k. High-end: $60k+.",
  },
  {
    category: "Bathroom Remodel",
    low: 6000,
    high: 35000,
    unit: "per bathroom",
    notes: "Basic: $6–10k. Mid-range: $15–20k. Luxury: $25k+.",
  },
  {
    category: "Flooring",
    low: 3,
    high: 22,
    unit: "per sq ft (installed)",
    notes: "Vinyl/laminate: $3–8/sqft. Hardwood: $8–16/sqft. Tile: $10–22/sqft.",
  },
  {
    category: "Painting (Interior)",
    low: 2,
    high: 6,
    unit: "per sq ft",
    notes: "Whole-house interior. Expect $1,800–$5,500 for an average home.",
  },
  {
    category: "Painting (Exterior)",
    low: 1,
    high: 4,
    unit: "per sq ft",
    notes: "Typical 1,500 sq ft home runs $1,500–$4,000.",
  },
  {
    category: "Deck / Patio",
    low: 4000,
    high: 22000,
    unit: "per project",
    notes: "Pressure-treated wood deck: $4–8k. Composite or large patio: up to $22k.",
  },
  {
    category: "Drywall",
    low: 1.5,
    high: 3.5,
    unit: "per sq ft (installed)",
    notes: "Hanging + finishing + painting. A full room runs $900–$2,800.",
  },
  {
    category: "Windows",
    low: 300,
    high: 1200,
    unit: "per window (installed)",
    notes: "Double-pane vinyl: $300–$600. Wood or specialty: up to $1,200 each.",
  },
  {
    category: "Landscaping",
    low: 500,
    high: 10000,
    unit: "per project",
    notes: "Basic cleanup/mulch: $500. Full redesign with hardscape: up to $10k+.",
  },
  {
    category: "Foundation / Basement",
    low: 2500,
    high: 30000,
    unit: "per project",
    notes: "Crack repair: $250–$2,500. Full waterproofing/underpinning: $10–30k.",
  },
  {
    category: "Siding",
    low: 5000,
    high: 20000,
    unit: "per home",
    notes: "Vinyl: $5–10k. Fiber cement: $8–16k. Wood: $12–20k.",
  },
];

async function main() {
  console.log("🌱 Seeding price ranges...");

  for (const item of seedData) {
    await prisma.priceRange.upsert({
      where: { category: item.category },
      update: {
        low: item.low,
        high: item.high,
        unit: item.unit,
        notes: item.notes,
      },
      create: item,
    });
    console.log(`  ✓ ${item.category}`);
  }

  console.log(`\n✅ Seeded ${seedData.length} price ranges.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
