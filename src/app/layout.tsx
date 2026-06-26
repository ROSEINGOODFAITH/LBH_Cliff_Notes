import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "LBH Cliff Notes",
  description: "Influencer marketing CRM for Laurel Bath House",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      {/* Dark mode is the default per the brand spec. */}
      <html lang="en" className="dark" suppressHydrationWarning>
        <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
