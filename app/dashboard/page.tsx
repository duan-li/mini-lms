import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ConsultationTable } from "@/components/consultations/consultation-table";
import { getViewer } from "@/lib/auth/viewer";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      {/* The session is read at request time, so it sits behind a boundary. */}
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading your consultations…</p>}>
        <StudentDashboard />
      </Suspense>
    </div>
  );
}

/**
 * Checks the session and role before anything renders. Signed out: login.
 * An admin: the read-only admin view. Data is not loaded here: the table
 * fetches it through the API, under the user's ID.
 */
async function StudentDashboard() {
  const viewer = await getViewer();
  if (!viewer) redirect("/auth/login");
  if (viewer.role === "admin") redirect("/admin");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">My consultations</h1>
          <p className="text-sm text-muted-foreground">Times are shown in your browser&apos;s time zone.</p>
        </div>
      </div>
      <ConsultationTable userId={viewer.id} />
    </>
  );
}
