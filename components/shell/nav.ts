/** Left-nav definition, ordered to mirror the live Landjourney admin console. */
export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Net-new section not in the real nav today (gets a "New" badge). */
  isNew?: boolean;
  section?: string;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/requests", label: "Requests", icon: "📥" },
  { href: "/customers", label: "Customers", icon: "👥" },
  { href: "/offers", label: "Offers", icon: "✉️" },
  { href: "/underwriting", label: "Underwriting", icon: "⚖️" },
  { href: "/loans", label: "Loans", icon: "💳" },
  { href: "/booking-events", label: "Booking Events", icon: "🏦" },
  { href: "/system-events", label: "System Events", icon: "📡" },
  { href: "/workflows", label: "Workflows", icon: "⚡", isNew: true },
  { href: "/templates", label: "Templates", icon: "🧩" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

/** Resolve the active nav item for a pathname (longest-prefix match). */
export function activeHref(pathname: string): string {
  if (pathname === "/") return "/";
  const match = NAV.filter((n) => n.href !== "/" && pathname.startsWith(n.href)).sort(
    (a, b) => b.href.length - a.href.length
  )[0];
  return match?.href ?? "/";
}
