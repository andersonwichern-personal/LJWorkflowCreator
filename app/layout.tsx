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

/**
 * Phase 5: apply the stored brand colour before first paint so a custom accent
 * doesn't flash the default teal. Mirrors lib/brand.tsx's hex→HSL math.
 */
const brandBootstrap = `
(function () {
  try {
    var raw = localStorage.getItem('wf-brand');
    if (!raw) return;
    var hex = (JSON.parse(raw) || {}).color;
    if (!hex) return;
    hex = String(hex).trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(hex)) hex = hex.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-f]{6}$/.test(hex)) return;
    var r = parseInt(hex.slice(0, 2), 16) / 255,
        g = parseInt(hex.slice(2, 4), 16) / 255,
        b = parseInt(hex.slice(4, 6), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = Math.round(h * 60); if (h < 0) h += 360;
    }
    var l = (max + min) / 2, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    var base = h + ' ' + Math.round(s * 100) + '% ' + Math.round(l * 100) + '%';
    var root = document.documentElement.style;
    root.setProperty('--accent', 'hsl(' + base + ')');
    root.setProperty('--accent-soft', 'hsl(' + base + ' / 0.12)');
    root.setProperty('--ring', 'hsl(' + base + ' / 0.4)');
  } catch (e) {}
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
        <script dangerouslySetInnerHTML={{ __html: brandBootstrap }} />
      </head>
      <body className={inter.variable}>
        {children}
      </body>
    </html>
  );
}
