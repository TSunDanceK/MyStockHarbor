import DashboardClient from "./components/DashboardClient";
import { Suspense } from "react";

export default function Page() {
  return (
    <>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "16px 40px 0",
          fontFamily: "system-ui, Arial",
          color: "rgba(241,245,249,0.72)",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        Educational stock dashboard and market research tools.
      </div>

      <Suspense fallback={<div style={{ padding: 40, fontFamily: "system-ui" }}>Loading dashboard…</div>}>
        <DashboardClient />
      </Suspense>
    </>
  );
}
