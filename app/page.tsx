import DashboardClient from "./components/DashboardClient";

export default function Page({ searchParams }: { searchParams?: { symbol?: string } }) {
  const symbol = (searchParams?.symbol ?? "AAPL").toUpperCase();
  return <DashboardClient defaultSymbol={symbol} />;
}
