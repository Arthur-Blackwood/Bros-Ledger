import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const themeInitScript = `(function(){try{var key="bros-ledger:theme:v1";var legacyKey="daylight-ledger:theme:v1";var value=localStorage.getItem(key)||localStorage.getItem(legacyKey);if(value)localStorage.setItem(key,value);var preference=value==="light"||value==="dark"?value:"system";var resolved=preference==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):preference;var palette=localStorage.getItem("bros-ledger:palette:v1");palette=palette==="ocean"||palette==="indigo"||palette==="plum"||palette==="terracotta"?palette:"forest";document.documentElement.dataset.theme=resolved;document.documentElement.dataset.themePreference=preference;document.documentElement.dataset.palette=palette;}catch(e){document.documentElement.dataset.theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.palette="forest";}})();`;

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Bro's Ledger · Personal finance";
  const description = "A local-first personal ledger that keeps your data on this device.";
  const image = `${origin}/og.png`;
  return {
    title,
    description,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      shortcut: "/favicon.svg",
      apple: "/icon-192.png",
    },
    openGraph: { title, description, type: "website", images: [{ url: image, width: 1672, height: 941, alt: "Bro's Ledger" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
