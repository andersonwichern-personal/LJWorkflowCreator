import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Workflow Creator · Sweet",
  description:
    "Design loan-origination automations in plain English — WHEN an event happens, IF conditions hold, THEN take action.",
};

/**
 * Set the theme before first paint to avoid a flash. Reads localStorage, then
 * falls back to the OS preference.
 */
const themeBootstrap = `
(function () {
  try {
    var saved = localStorage.getItem('wf-theme');
    var theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
