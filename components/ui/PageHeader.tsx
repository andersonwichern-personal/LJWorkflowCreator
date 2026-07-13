import { ReactNode } from "react";

/** Consistent section page header: title, subtitle, optional right-side actions. */
export default function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {icon && (
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl text-xl"
            style={{ background: "var(--accent-soft)" }}
            aria-hidden
          >
            {icon}
          </span>
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--fg)" }}>
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 text-sm" style={{ color: "var(--fg-subtle)" }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
