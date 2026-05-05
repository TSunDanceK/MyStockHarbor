import type { Metadata } from "next";
import PlaysClient from "./PlaysClient";

export const metadata: Metadata = {
  title: "Stock Plays | Chart Pattern Setups | MyStockHarbor",
  description:
    "Find daily and weekly stock chart-pattern plays using MyStockHarbor's ascending triangle scanner.",
};

export default function PlaysPage() {
  return <PlaysClient />;
}
