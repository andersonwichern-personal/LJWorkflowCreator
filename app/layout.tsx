import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/* Crisp sans-serif for the Landjourney admin look; exposed as --font-sans. */
const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "Landjourney Admin Console",
    template: "%s · Landjourney",
  },
  description:
    "Loan-origination admin console with a plain-English Workflow Creator — WHEN an event happens, IF conditions hold, THEN take action.",
  applicationName: "Landjourney",
  authors: [{ name: "Landjourney" }],
  keywords: ["loan origination", "workflow", "automation", "underwriting", "banking"],
  openGraph: {
    title: "Landjourney Admin Console",
    description: "Automate loan origination in plain English with the Workflow Creator.",
    type: "website",
    siteName: "Landjourney",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
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
      <body className={inter.variable}>
        {children}
      </body>
    </html>
  );
}
