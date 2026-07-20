import type { Metadata } from "next";
import { Fraunces, DM_Sans, Caveat, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RootProviders } from "@/providers";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

const hand = Caveat({
  variable: "--font-hand",
  subsets: ["latin"],
  weight: ["500", "600"],
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agabi",
  description: "A learning operating system. Understand anything.",
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
      className={`${display.variable} ${sans.variable} ${hand.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="h-full">
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
