import type { Metadata, Viewport } from "next";
import { PT_Sans, Pixelify_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const body = PT_Sans({ subsets: ["latin", "cyrillic"], weight: ["400", "700"], variable: "--font-body" });
const pixel = Pixelify_Sans({ subsets: ["latin", "cyrillic"], weight: ["400", "600", "700"], variable: "--font-pixel" });

export const metadata: Metadata = {
  title: "NEMESIS: Восхождение двух королей",
  description: "Персональная RPG-стратегия: реальные цели превращаются в развитие героя и королевства.",
  applicationName: "NEMESIS",
  appleWebApp: { capable: true, title: "NEMESIS", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#120e18",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${body.variable} ${pixel.variable}`}>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
