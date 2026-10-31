import { Suspense } from "react";
import { AppShell } from "@/features/shell/AppShell";
import { DashboardPage } from "@/features/dashboard/DashboardPage";

export default function Home() {
  return (
    <Suspense>
      <AppShell>
        <DashboardPage />
      </AppShell>
    </Suspense>
  );
}
