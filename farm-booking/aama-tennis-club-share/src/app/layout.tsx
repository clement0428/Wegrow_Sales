import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "WeGrow 威果農場｜參訪預約",
  description: "查看開放場次、預約農場參訪，並管理您的預約。",
  openGraph: {
    title: "WeGrow 威果農場｜參訪預約",
    description: "從 LINE 查看開放日期、完成預約與付款。",
    url: SITE_URL,
    siteName: "WeGrow 威果農場",
    locale: "zh_TW",
    type: "website",
    images: [{ url: "/brand/wegrow-greenhouse.jpg", width: 2400, height: 1350, alt: "WeGrow 麻豆科技溫室" }],
  },
  icons: { icon: "/brand/wegrow-logo.png", apple: "/brand/wegrow-logo.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#163d2a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
