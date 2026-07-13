import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { BarList, Donut, AreaTrend } from "@/components/ui/charts";
import WorkflowActivity from "@/components/WorkflowActivity";
import {
  totalPipelineVolume,
  bookedVolume,
  avgLoanSize,
  approvalRate,
  volumeByRetailer,
  requestsByStage,
  bookingStatusBreakdown,
  monthlyVolume,
  formatCurrency,
} from "@/lib/analytics";

export const metadata = { title: "Insights · Landjourney" };

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>{title}</h3>
        {subtitle && <p className="text-xs" style={{ color: "var(--fg-subtle)" }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export default function InsightsPage() {
  return (
    <div>
      <PageHeader title="Insights" icon="📊" subtitle="Portfolio health, volume, and automation activity at a glance." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pipeline volume" value={formatCurrency(totalPipelineVolume())} hint="open requests" icon="📈" />
        <StatCard label="Booked volume" value={formatCurrency(bookedVolume())} hint="confirmed to core" icon="🏦" />
        <StatCard label="Approval rate" value={`${approvalRate()}%`} hint="of decided requests" icon="✅" />
        <StatCard label="Avg loan size" value={formatCurrency(avgLoanSize())} hint="across book" icon="💵" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard title="Booked loan volume" subtitle="Monthly, last 6 months">
          <AreaTrend data={monthlyVolume()} money />
        </ChartCard>

        <ChartCard title="Booking status" subtitle="Distribution across all requests">
          <Donut segments={bookingStatusBreakdown()} centerLabel="requests" />
        </ChartCard>

        <ChartCard title="Volume by retailer" subtitle="Total requested amount">
          <BarList data={volumeByRetailer()} money />
        </ChartCard>

        <ChartCard title="Requests by stage" subtitle="Pipeline distribution">
          <BarList data={requestsByStage()} tone="accent" />
        </ChartCard>
      </div>

      <div className="mt-5">
        <WorkflowActivity />
      </div>
    </div>
  );
}
