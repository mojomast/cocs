import type { Metadata } from "next";
import type { Viewport } from "next";
import "./globals.css";

const title = "Colosseum Of Competitive Slop — COCS";
const description = "Colosseum Of Competitive Slop (COCS): pick an AI operator and harness, then brawl across 3D arenas in solo bot matches or hosted multiplayer.";

export const metadata: Metadata = {
  metadataBase: new URL("https://arena.ussyco.de"),
  title,
  description,
  applicationName: "Colosseum Of Competitive Slop",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    siteName: "Colosseum Of Competitive Slop",
    title,
    description,
    url: "/",
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080f13",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
