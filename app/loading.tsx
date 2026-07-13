export default function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading">
      <div
        className="h-8 w-8 animate-spin rounded-full"
        style={{ border: "3px solid var(--panel-border)", borderTopColor: "var(--accent)" }}
      />
    </div>
  );
}
