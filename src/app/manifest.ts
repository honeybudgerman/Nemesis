import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NEMESIS: Восхождение двух королей",
    short_name: "NEMESIS",
    description: "Персональная RPG-стратегия с реальными заданиями",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    background_color: "#120e18",
    theme_color: "#120e18",
    lang: "ru",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
