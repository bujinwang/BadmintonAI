import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AUTHOR, LINKS, SITE_URL } from "@/lib/site";

const archivo = Archivo({
  variable: "--font-archivo",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const DESC =
  "Coach-grade badminton match analytics from raw broadcast video — player tracking, shuttle tracking, shot classification and score OCR, with a fully label-free AI mode.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "COURTSIDE — badminton match intelligence",
  description: DESC,
  authors: [{ name: AUTHOR, url: LINKS.site }],
  openGraph: {
    type: "website",
    siteName: "COURTSIDE",
    title: "COURTSIDE — badminton match intelligence",
    description: DESC,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "COURTSIDE" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "COURTSIDE — badminton match intelligence",
    description: DESC,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="night"
      suppressHydrationWarning
      className={`${archivo.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        {/* apply the saved theme before first paint (see Next.js
            "preventing flash before hydration" guide) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("cs-theme");if(t==="shiro"||t==="night")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
