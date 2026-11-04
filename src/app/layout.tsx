import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GOLD INTELLIGENCE AI — Institutional Gold Market Intelligence",
  description:
    "Understand the Market. Decode Liquidity. Predict with Intelligence. AI-powered Gold (XAUUSD / COMEX GC1!) market intelligence, ICT/SMC detection, liquidity mapping and explainable predictions.",
  keywords: ["Gold", "XAUUSD", "GC1!", "COMEX", "ICT", "SMC", "Liquidity", "AI", "Trading"],
  authors: [{ name: "GOLD INTELLIGENCE AI" }],
  openGraph: {
    title: "GOLD INTELLIGENCE AI",
    description: "Institutional Gold Market Intelligence & Prediction Platform",
    siteName: "GOLD INTELLIGENCE AI",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
