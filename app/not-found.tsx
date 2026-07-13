import Link from "next/link";

export default function NotFound() {
  return (
    <div className="glass mx-auto max-w-md rounded-2xl p-10 text-center">
      <div
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold text-white"
        style={{ background: "linear-gradient(135deg, var(--accent), #a855f7)" }}
      >
        ⚡
      </div>
      <h1 className="mt-4 text-2xl font-semibold" style={{ color: "var(--fg)" }}>Page not found</h1>
      <p className="mt-1.5 text-sm" style={{ color: "var(--fg-subtle)" }}>
        That page doesn&apos;t exist in the console. It may have moved.
      </p>
      <Link
        href="/"
        className="ring-accent mt-5 inline-block rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:brightness-110"
        style={{ background: "var(--accent)" }}
      >
        Back to Home
      </Link>
    </div>
  );
}
