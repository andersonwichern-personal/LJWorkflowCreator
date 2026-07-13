import { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  /** Cell renderer. */
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Hide below the sm breakpoint to keep mobile tidy. */
  hideOnMobile?: boolean;
}

/** Lightweight, theme-aware table with a horizontal-scroll container. */
export default function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty = "Nothing here yet.",
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
}) {
  return (
    <div className="glass scroll-thin overflow-x-auto rounded-2xl">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--panel-border)" }}>
            {columns.map((c) => (
              <th
                key={c.key}
                className={[
                  "px-4 py-3 text-[11px] font-semibold uppercase tracking-wider",
                  c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                  c.hideOnMobile ? "hidden sm:table-cell" : "",
                ].join(" ")}
                style={{ color: "var(--fg-subtle)" }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-sm" style={{ color: "var(--fg-subtle)" }}>
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr
              key={row.id}
              className="transition-colors hover:bg-[var(--accent-soft)]"
              style={{ borderBottom: "1px solid var(--panel-border)" }}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={[
                    "px-4 py-3 align-middle",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                    c.hideOnMobile ? "hidden sm:table-cell" : "",
                  ].join(" ")}
                  style={{ color: "var(--fg)" }}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
