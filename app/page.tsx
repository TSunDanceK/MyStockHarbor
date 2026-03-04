import DashboardClient from "./components/DashboardClient";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 40, fontFamily: "system-ui" }}>Loading dashboard…</div>}>
      <DashboardClient />
    </Suspense>
  );
}
