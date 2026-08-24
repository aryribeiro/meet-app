import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Privacidade: cabeçalhos restritivos em todas as respostas.
  // - permissions-policy: câmera/microfone permitidos só para a própria origem (o app precisa deles).
  // - referrer-policy: o link da sala nunca vaza via Referer para sites externos.
  // - x-frame-options: impede embutir o app em iframe de terceiros (clickjacking sobre os botões de mídia).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), display-capture=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
