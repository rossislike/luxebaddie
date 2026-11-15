import type { Metadata } from "next";
import { Bodoni_Moda, Jost } from "next/font/google";
import "./globals.css";

const bodoni = Bodoni_Moda({ variable: "--font-bodoni", subsets: ["latin"], style: ["normal", "italic"] });
const jost = Jost({ variable: "--font-jost", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "LuxeBaddie back office", template: "%s - LuxeBaddie back office" },
  // Private: no page here should ever turn up in a search engine.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bodoni.variable} ${jost.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
