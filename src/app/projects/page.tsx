import { Suspense } from "react";
import type { Metadata } from "next";
import { AppShell } from "@/features/shell/AppShell";
import { ProjectsLibraryPage } from "@/features/projects/ProjectsLibraryPage";

export const metadata: Metadata = { title: "Projetos" };

export default function Projects() {
  return (
    <Suspense>
      <AppShell>
        <ProjectsLibraryPage />
      </AppShell>
    </Suspense>
  );
}
