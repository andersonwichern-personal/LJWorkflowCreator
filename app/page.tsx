"use client";

import { useState, useEffect, useCallback } from "react";
import { evaluateQuote, type Verdict } from "@/lib/priceData";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceRange {
  id: string;
  category: string;
  low: number;
  high: number;
  unit: string;
  notes: string;
}

interface QuoteRecord {
  id: string;
  contractor: string;
  amount: number;
  category: string;
  verdict: Verdict;
  message: string;
  percentOfMidpoint: number;
  createdAt: string;
  priceRange: Pick<PriceRange, "low" | "high" | "unit" | "notes">;
}

// ─── Verdict styles ───────────────────────────────────────────────────────────

const VERDICT_STYLES: Record<
  Verdict,
  { bg: string; border: string; text: string; badge: string; label: string }
> = {
  great: {
    bg: "bg-emerald-50",
    border: "border-emerald-400",
    text: "text-emerald-800",
    badge: "bg-emerald-100 text-emerald-700",
    label: "Below Market",
  },
  fair: {
    bg: "bg-blue-50",
    border: "border-blue-400",
    text: "text-blue-800",
    badge: "bg-blue-100 text-blue-700",
    label: "Fair Price",
  },
  high: {
    bg: "bg-amber-50",
    border: "border-amber-400",
    text: "text-amber-800",
    badge: "bg-amber-100 text-amber-700",
    label: "Above Average",
  },
  very_high: {
    bg: "bg-red-50",
    border: "border-red-400",
    text: "text-red-800",
    badge: "bg-red-100 text-red-700",
    label: "Overpriced",
  },
};

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [priceRanges, setPriceRanges] = useState<PriceRange[]>([]);
  const [quotes, setQuotes] = useState<QuoteRecord[]>([]);
  const [activeResult, setActiveResult] = useState<QuoteRecord | null>(null);
  const [loadingRanges, setLoadingRanges] = useState(true);
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dbAvailable, setDbAvailable] = useState(true);

  const [contractor, setContractor] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");

  // Fetch price ranges from DB
  const fetchPriceRanges = useCallback(async () => {
    try {
      const res = await fetch("/api/price-ranges");
      if (!res.ok) throw new Error("Failed");
      const data: PriceRange[] = await res.json();
      setPriceRanges(data);
    } catch {
      setDbAvailable(false);
    } finally {
      setLoadingRanges(false);
    }
  }, []);

  // Fetch quote history from DB
  const fetchQuotes = useCallback(async () => {
    try {
      const res = await fetch("/api/quotes");
      if (!res.ok) throw new Error("Failed");
      const data: QuoteRecord[] = await res.json();
      setQuotes(data);
    } catch {
      // silently fail — history just won't show
    } finally {
      setLoadingQuotes(false);
    }
  }, []);

  useEffect(() => {
    fetchPriceRanges();
    fetchQuotes();
  }, [fetchPriceRanges, fetchQuotes]);

  const selectedRange = priceRanges.find((r) => r.category === category) ?? null;

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!category || !amount) return;
    const numAmount = parseFloat(amount.replace(/[^0-9.]/g, ""));
    if (isNaN(numAmount) || numAmount <= 0) return;

    setSubmitting(true);

    // Optimistic client-side evaluation for instant feedback
    const { verdict, message, percentOfMidpoint } = evaluateQuote(
      category as Parameters<typeof evaluateQuote>[0],
      numAmount
    );

    const optimistic: QuoteRecord = {
      id: "optimistic",
      contractor: contractor || "Unknown Contractor",
      amount: numAmount,
      category,
      verdict,
      message,
      percentOfMidpoint,
      createdAt: new Date().toISOString(),
      priceRange: selectedRange
        ? { low: selectedRange.low, high: selectedRange.high, unit: selectedRange.unit, notes: selectedRange.notes }
        : { low: 0, high: 0, unit: "", notes: "" },
    };
    setActiveResult(optimistic);

    // Persist to DB
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractor: contractor || "Unknown Contractor",
          category,
          amount: numAmount,
        }),
      });

      if (res.ok) {
        const saved: QuoteRecord = await res.json();
        setActiveResult(saved);
        setQuotes((prev) => [saved, ...prev]);
      } else {
        // DB unavailable — still show local result
        setQuotes((prev) => [optimistic, ...prev]);
      }
    } catch {
      setQuotes((prev) => [optimistic, ...prev]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">QuoteCheck</h1>
              <p className="text-xs text-slate-500">Contractor Quote Verifier</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!dbAvailable && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                DB not connected
              </span>
            )}
            {dbAvailable && !loadingRanges && (
              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">
                DB connected
              </span>
            )}
            <span className="text-xs text-slate-400 hidden sm:block">
              Prices based on U.S. national averages
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Quotes Checked", value: quotes.length },
            { label: "Fair / Below", value: quotes.filter((r) => r.verdict === "fair" || r.verdict === "great").length },
            { label: "Above Average", value: quotes.filter((r) => r.verdict === "high").length },
            { label: "Overpriced", value: quotes.filter((r) => r.verdict === "very_high").length },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 text-center shadow-sm">
              <p className="text-2xl font-bold text-slate-900">{value}</p>
              <p className="text-xs text-slate-500 mt-1">{label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Check a Quote Form */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Check a Quote</h2>
            <form onSubmit={handleCheck} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Contractor Name
                </label>
                <input
                  type="text"
                  value={contractor}
                  onChange={(e) => setContractor(e.target.value)}
                  placeholder="e.g. Acme Roofing Co."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Job Type <span className="text-red-500">*</span>
                </label>
                {loadingRanges ? (
                  <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
                ) : (
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  >
                    <option value="">Select a job type...</option>
                    {priceRanges.map((r) => (
                      <option key={r.id} value={r.category}>{r.category}</option>
                    ))}
                  </select>
                )}
              </div>

              {selectedRange && (
                <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                  Typical range:{" "}
                  <span className="font-medium text-slate-700">
                    {formatCurrency(selectedRange.low)} – {formatCurrency(selectedRange.high)}
                  </span>{" "}
                  {selectedRange.unit}
                  <br />
                  <span className="italic">{selectedRange.notes}</span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Quoted Amount ($) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 8500"
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || loadingRanges}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
              >
                {submitting ? "Checking..." : "Check This Quote"}
              </button>
            </form>
          </div>

          {/* Result Panel */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Result</h2>
            {activeResult ? (
              <ResultCard result={activeResult} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
                <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                  <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-slate-500 text-sm">Enter a quote to see if it&apos;s in range</p>
              </div>
            )}
          </div>
        </div>

        {/* History */}
        {(loadingQuotes || quotes.length > 0) && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Quote History</h2>
            {loadingQuotes ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {quotes.map((r) => {
                  const styles = VERDICT_STYLES[r.verdict];
                  return (
                    <div
                      key={r.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border ${styles.border} ${styles.bg}`}
                    >
                      <div>
                        <p className="font-medium text-sm text-slate-800">{r.contractor}</p>
                        <p className="text-xs text-slate-500">
                          {r.category} · {r.priceRange.unit}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-slate-800">
                          {formatCurrency(r.amount)}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles.badge}`}>
                          {styles.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Price Reference Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Price Reference Guide</h2>
          {loadingRanges ? (
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="pb-2 pr-4 font-medium">Job Type</th>
                    <th className="pb-2 pr-4 font-medium">Low</th>
                    <th className="pb-2 pr-4 font-medium">High</th>
                    <th className="pb-2 font-medium hidden sm:table-cell">Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {priceRanges.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2 pr-4 font-medium text-slate-700">{r.category}</td>
                      <td className="py-2 pr-4 text-emerald-700">{formatCurrency(r.low)}</td>
                      <td className="py-2 pr-4 text-slate-700">{formatCurrency(r.high)}</td>
                      <td className="py-2 text-slate-400 text-xs hidden sm:table-cell">{r.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      <footer className="text-center text-xs text-slate-400 py-6">
        Prices are estimates based on U.S. national averages and may vary by region. Always get multiple bids.
      </footer>
    </div>
  );
}

// ─── Result Card ──────────────────────────────────────────────────────────────

function ResultCard({ result }: { result: QuoteRecord }) {
  const styles = VERDICT_STYLES[result.verdict];
  const { low, high, notes } = result.priceRange;
  const barMin = low * 0.5;
  const barMax = high * 1.5;
  const barRange = barMax - barMin;
  const lowPct = ((low - barMin) / barRange) * 100;
  const highPct = ((high - barMin) / barRange) * 100;
  const clampedAmount = Math.min(Math.max(result.amount, barMin), barMax);
  const markerPct = ((clampedAmount - barMin) / barRange) * 100;

  return (
    <div className={`rounded-xl border-2 ${styles.border} ${styles.bg} p-5 flex-1 flex flex-col gap-4`}>
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-xs font-medium uppercase tracking-wide ${styles.text} opacity-70`}>
            {result.contractor}
          </p>
          <p className="text-2xl font-bold text-slate-900 mt-0.5">
            {formatCurrency(result.amount)}
          </p>
          <p className="text-sm text-slate-600">{result.category}</p>
        </div>
        <span className={`text-sm font-semibold px-3 py-1 rounded-full ${styles.badge}`}>
          {styles.label}
        </span>
      </div>

      {/* Price bar */}
      <div>
        <div className="relative h-5 bg-slate-200 rounded-full overflow-visible">
          <div
            className="absolute top-0 h-full bg-emerald-200 rounded-full"
            style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
          />
          <div
            className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md bg-indigo-600"
            style={{ left: `${markerPct}%`, top: "50%", transform: "translate(-50%, -50%)" }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-500 mt-1">
          <span>{formatCurrency(low)}</span>
          <span className="text-slate-400">typical range</span>
          <span>{formatCurrency(high)}</span>
        </div>
      </div>

      <p className={`text-sm ${styles.text}`}>{result.message}</p>

      <div className="text-xs text-slate-500 italic border-t border-slate-200 pt-3">
        {notes}
      </div>
    </div>
  );
}
