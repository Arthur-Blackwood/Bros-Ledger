import type { Metadata } from "next";
import { LedgerApp } from "./ledger-app";

export const metadata: Metadata = {
  title: "Bro's Ledger · Personal finance",
  description: "A local-first personal ledger that keeps your data on this device.",
};

export default function Home() {
  return <LedgerApp />;
}
