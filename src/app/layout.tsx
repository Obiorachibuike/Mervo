import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/misc";

export const metadata: Metadata = {
  title: {
    default: "MERVO — Intelligent Business Management and AI-Powered POS Platform",
    template: "%s · MERVO",
  },
  description:
    "MERVO is an intelligent business operating system: a fast POS, AI inventory forecasting, double-entry accounting, multi-branch control and a conversational business analyst — built for African and international retail.",
  applicationName: "MERVO",
  keywords: ["MERVO", "POS", "point of sale", "inventory management", "AI business intelligence", "retail software Nigeria"],
  authors: [{ name: "MERVO" }],
  openGraph: {
    title: "MERVO — Intelligent Business Management and AI-Powered POS Platform",
    description: "Sales, inventory, finance, staff and AI analytics in one operating system for growing businesses.",
    siteName: "MERVO",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F8F7" },
    { media: "(prefers-color-scheme: dark)", color: "#0C1013" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // Apply the stored theme before paint to avoid a flash of the wrong theme.
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('mervo-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
