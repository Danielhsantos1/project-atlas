import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/ui/Toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PROJECT ATLAS", template: "%s · PROJECT ATLAS" },
  description: "Plataforma de arquitetura, engenharia, construção e modelagem 3D.",
};

export const viewport: Viewport = { themeColor: "#0e1014" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans text-[13px] antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
