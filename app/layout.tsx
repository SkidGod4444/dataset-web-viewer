import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ProductionGuard } from "@/components/ProductionGuard";
import { ContentProtection } from "@/components/ContentProtection";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "NEUROSCAPE Dataset Viewer",
    template: "%s · NEUROSCAPE Dataset Viewer",
  },
  description:
    "Confidential dataset viewer for NEUROSCAPE Imaging Pvt. Ltd. — authorized, watermarked access only.",
  applicationName: "NEUROSCAPE Dataset Viewer",
  authors: [{ name: "NEUROSCAPE Imaging Pvt. Ltd." }],
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
  // Confidential, access-controlled app — keep it out of search engines.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  openGraph: {
    type: "website",
    siteName: "NEUROSCAPE Dataset Viewer",
    title: "NEUROSCAPE Dataset Viewer",
    description: "Confidential — authorized access only.",
    images: [{ url: "/logo.png", width: 500, height: 499, alt: "NEUROSCAPE" }],
  },
  twitter: {
    card: "summary",
    title: "NEUROSCAPE Dataset Viewer",
    description: "Confidential — authorized access only.",
    images: ["/logo.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0c" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ProductionGuard />
          <ContentProtection />
          <TooltipProvider delay={200}>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
