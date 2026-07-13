import Link from "next/link";
import { REQUESTS, getRequest } from "@/lib/platformData";
import RequestDetail from "@/components/RequestDetail";

/** Pre-render a detail page for each seed request. */
export function generateStaticParams() {
  return REQUESTS.map((r) => ({ id: r.id }));
}

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const request = getRequest(id);

  if (!request) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="text-lg font-semibold" style={{ color: "var(--fg)" }}>Request not found</p>
        <p className="mt-1 text-sm" style={{ color: "var(--fg-subtle)" }}>{id} doesn&apos;t exist in this workspace.</p>
        <Link href="/requests" className="mt-3 inline-block text-sm font-medium" style={{ color: "var(--accent)" }}>
          ← Back to Requests
        </Link>
      </div>
    );
  }

  return <RequestDetail request={request} />;
}
