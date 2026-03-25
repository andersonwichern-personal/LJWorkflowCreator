import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuoteCheck – Contractor Quote Verifier",
  description: "Verify if your contractor quote is in the right price range",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50">{children}</body>
    </html>
  );
}
