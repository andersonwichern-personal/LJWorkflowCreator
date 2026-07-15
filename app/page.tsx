import AdminShell from "@/components/AdminShell";

/**
 * Landing: the Existing Workflows dashboard inside the admin shell (collapsible
 * sidebar + brand theming + viewpoint gating). The sidebar's Workflows entry is
 * the active page; Root Tools / System Events reach Approval Authorities and
 * Audit Logs.
 */
export default function HomePage() {
  return <AdminShell />;
}
