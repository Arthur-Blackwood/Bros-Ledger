import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bro's Ledger",
    short_name: "Bro's Ledger",
    description: "A local-first personal ledger that keeps your data on this device.",
    display: "standalone",
    background_color: "#FFF9F0",
    theme_color: "#242629",
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Full-bleed art with the mark inside the 80% safe circle, so Android can
      // apply its own shape mask without cropping into the bars.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
