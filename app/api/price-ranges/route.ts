import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const ranges = await prisma.priceRange.findMany({
      orderBy: { category: "asc" },
    });
    return NextResponse.json(ranges);
  } catch (error) {
    console.error("Failed to fetch price ranges:", error);
    return NextResponse.json(
      { error: "Failed to fetch price ranges" },
      { status: 500 }
    );
  }
}
