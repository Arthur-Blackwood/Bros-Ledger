import type { Metadata } from "next";
import { LedgerApp } from "./ledger-app";

export const metadata: Metadata = {
  title: "拾光账本 · 每日记账",
  description: "轻松记录每一笔，把账单截图变成清晰的每日账单。",
};

export default function Home() {
  return <LedgerApp />;
}
