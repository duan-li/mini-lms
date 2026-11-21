import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminConsultationTable } from "@/components/admin/admin-consultation-table";
import { getViewer } from "@/lib/auth/viewer";
import { ADMIN_PAGE_SIZE, adminListQuerySchema } from "@/lib/validation/consultation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      {/* The session and the query string are read at request time, so they sit behind a boundary. */}
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading all consultations…</p>}>
        <AdminDashboard searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/**
 * Checks the session and role before anything renders. Signed out: login.
 * A student: their own dashboard. Data is not loaded here: the table fetches
 * it through the admin API, which checks the role again.
 */
async function AdminDashboard({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/auth/login");
  if (viewer.role !== "admin") redirect("/dashboard");

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">All consultations</h1>
        <p className="text-sm text-muted-foreground">
          Every student&apos;s bookings, cancelled ones included, ordered by consultation time. Read-only. Times are
          shown in your browser&apos;s time zone.
        </p>
      </div>
      <AdminConsultationTable userId={viewer.id} pageSize={pageSize((await searchParams).limit)} />
    </>
  );
}

/** `?limit=` (1 to 100) sets the page size, with the same rule as the API; anything else uses the default. */
function pageSize(value: string | string[] | undefined): number {
  const parsed = adminListQuerySchema.shape.limit.safeParse(typeof value === "string" ? value : undefined);
  return parsed.success ? parsed.data : ADMIN_PAGE_SIZE.default;
}
