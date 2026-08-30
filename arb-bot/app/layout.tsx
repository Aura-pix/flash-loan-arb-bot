import type { Metadata } from "next";
import "./globals.css";
import StatusRing from "../components/StatusRing";
import Navigation from "../components/Navigation";

export const metadata: Metadata = {
  title: "0xAurora",
  description: "Flash Loan Arbitrage Bot",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-ink font-sans">
        {/* Header */}
        <header className="h-14 border-b border-line flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="font-display font-bold text-lg tracking-tight text-ink">
              0xAurora
            </h1>
            <div className="h-4 w-px bg-line" />
            <StatusRing />
          </div>
          <Navigation />
        </header>
        
        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </body>
    </html>
  );
}
