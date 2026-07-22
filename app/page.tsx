import type { Metadata } from "next";
import { LedgerApp } from "./ledger-app";

export const metadata: Metadata = {
  title: "Daylight Ledger · Personal finance",
  description: "A calm personal ledger for everyday life under southern skies.",
};

export default function Home() {
  return <LedgerApp />;
}
