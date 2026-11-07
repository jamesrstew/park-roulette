import type { Metadata, Viewport } from "next";
import { Gochi_Hand, Shantell_Sans } from "next/font/google";
import { Suspense } from "react";
import { BottomNav, NavBar } from "@/components/BottomNav";
import { CrayonDefs } from "@/components/CrayonDefs";
import { HelloToast } from "@/components/HelloToast";
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
  // Big picture previews everywhere; X falls back to each page's og:image.
  twitter: { card: "summary_large_image" },
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
      className={`${gochi.variable} ${shantell.variable} h-full antialiased`}
    >
      <head>
        {/* Android's install prompt can fire before our JS loads; keep it for later. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bip=e;});",
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <CrayonDefs />
        <HelloToast />
        <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-32">
          {children}
        </main>
        <Suspense fallback={<NavBar path="" />}>
          <BottomNav />
        </Suspense>
      </body>
    </html>
  );
}
