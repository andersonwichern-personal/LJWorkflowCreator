import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { evaluateQuote } from "@/lib/priceData";

// GET /api/quotes — fetch quote history (most recent 50)
export async function GET() {
  try {
    const quotes = await prisma.quote.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        priceRange: {
          select: { low: true, high: true, unit: true, notes: true },
        },
      },
    });
    return NextResponse.json(quotes);
  } catch (error) {
    console.error("Failed to fetch quotes:", error);
    return NextResponse.json(
      { error: "Failed to fetch quotes" },
      { status: 500 }
    );
  }
}

// POST /api/quotes — save a new quote
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contractor, category, amount } = body as {
      contractor: string;
      category: string;
      amount: number;
    };

    if (!category || !amount || isNaN(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "category and a positive amount are required" },
        { status: 400 }
      );
    }

    // Validate category exists in DB
    const priceRange = await prisma.priceRange.findUnique({
      where: { category },
    });

    if (!priceRange) {
      return NextResponse.json(
        { error: `Unknown category: ${category}` },
        { status: 400 }
      );
    }

    // Evaluate on the server using the same logic
    const { verdict, message, percentOfMidpoint } = evaluateQuote(
      category as Parameters<typeof evaluateQuote>[0],
      amount
    );

    const quote = await prisma.quote.create({
      data: {
        contractor: contractor || "Unknown Contractor",
        amount,
        category,
        verdict,
        message,
        percentOfMidpoint,
      },
      include: {
        priceRange: {
          select: { low: true, high: true, unit: true, notes: true },
        },
      },
    });

    return NextResponse.json(quote, { status: 201 });
  } catch (error) {
    console.error("Failed to save quote:", error);
    return NextResponse.json(
      { error: "Failed to save quote" },
      { status: 500 }
    );
  }
}
