import type { Metadata } from "next";
import "@fontsource/source-serif-4/500.css";
import "@fontsource/source-serif-4/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@/styles/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Field Notes",
  description: "Private trip planner",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
