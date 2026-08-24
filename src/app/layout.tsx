import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "🎥 Meet App! — chamadas de vídeo privadas",
  description:
    "Chamadas de vídeo e voz entre duas pessoas, com privacidade de verdade: a conversa vai direto de um aparelho ao outro, sem passar por servidores.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0b1017",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
