import type { Metadata, Viewport } from "next";
import { Cabin_Sketch, Gochi_Hand, Shantell_Sans } from "next/font/google";
import { BottomNav } from "@/components/BottomNav";
import { CrayonDefs } from "@/components/CrayonDefs";
import "./globals.css";

const gochi = Gochi_Hand({
  variable: "--font-gochi",
  weight: "400",
  subsets: ["latin"],
});
const shantell = Shantell_Sans({
  variable: "--font-shantell",
  subsets: ["latin"],
});
const sketch = Cabin_Sketch({
  variable: "--font-cabin-sketch",
  weight: ["400", "700"],
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Park Roulette", template: "%s · Park Roulette" },
  description:
    "Spin the wheel, find a playground. Our quest to visit every playground in Central Oregon.",
  applicationName: "Park Roulette",
  appleWebApp: {
    capable: true,
    title: "Park Roulette",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "Park Roulette",
    description:
      "Spin the wheel, find a playground. Every playground in Central Oregon, one spin at a time.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#fffaf0",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${gochi.variable} ${shantell.variable} ${sketch.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <CrayonDefs />
        <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-32">
          {children}
        </main>
        <BottomNav />
      </body>
    </html>
  );
}
