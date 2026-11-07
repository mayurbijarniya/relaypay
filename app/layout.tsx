import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

const TITLE = "RelayPay · AI reordering for café suppliers";
const DESCRIPTION =
  "An AI agent proposes each café's next order, the café approves it, and PayPal keeps a fingerprint of that approval for any dispute.";

export const metadata: Metadata = {
  // Absolute URLs for link previews; set NEXT_PUBLIC_BASE_URL to the hosted address.
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "RelayPay",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "RelayPay: the purchasing agent proposes a café order and waits for the café's approval" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#18191b" },
    { media: "(prefers-color-scheme: light)", color: "#f4f4f2" },
  ],
};

// Dark is the default. A saved preference is applied before first paint so the
// page never flashes the wrong theme.
const themeScript = `try{var t=localStorage.getItem("relaypay-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
