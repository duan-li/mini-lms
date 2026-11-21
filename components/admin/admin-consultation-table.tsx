"use client";

import { StatusBadge } from "@/components/consultations/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/datetime";
import { useAdminConsultations } from "@/lib/queries/admin-consultations";
import type { AdminConsultationDTO } from "@/lib/services/consultation-dto";
import { cn } from "@/lib/utils";

const COLUMNS = 4;

/**
 * Every consultation in the system, read-only: no edit controls at all. The
 * API (withAdmin) and RLS (no admin write policy) enforce the same thing, so
 * the missing buttons are only the visible part of the rule.
 */
export function AdminConsultationTable({ userId, pageSize }: { userId: string; pageSize: number }) {
  const { rows, isPending, error, retry, isRetrying, hasMore, isLoadingMore, loadMore } =
    useAdminConsultations(userId, pageSize);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <MessageRow>Loading consultations…</MessageRow>
            ) : rows.length === 0 && !error ? (
              <MessageRow>No consultations have been booked yet.</MessageRow>
            ) : (
              rows.map((consultation) => <AdminConsultationRow key={consultation.id} consultation={consultation} />)
            )}
            {error && (
              <MessageRow>
                <span role="alert" className="text-destructive">
                  {error.message}
                </span>{" "}
                <Button size="sm" variant="outline" className="ml-2" onClick={retry} disabled={isRetrying}>
                  {isRetrying ? "Retrying…" : "Retry"}
                </Button>
              </MessageRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <span aria-live="polite">
          {isPending ? null : `Showing ${rows.length} consultation${rows.length === 1 ? "" : "s"}`}
          {!isPending && !hasMore && !isLoadingMore && !error && rows.length > 0 ? ", all loaded." : null}
        </span>
        {(hasMore || isLoadingMore) && (
          <Button variant="outline" onClick={loadMore} disabled={isLoadingMore || Boolean(error)}>
            {isLoadingMore ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    </div>
  );
}

function MessageRow({ children }: { children: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={COLUMNS} className="h-24 text-center text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

function AdminConsultationRow({ consultation }: { consultation: AdminConsultationDTO }) {
  return (
    <TableRow
      data-testid="admin-consultation-row"
      data-consultation-id={consultation.id}
      className={cn(consultation.status === "cancelled" && "text-muted-foreground")}
    >
      <TableCell className="whitespace-nowrap">
        <span className={cn(consultation.status === "cancelled" && "line-through")}>
          {formatDateTime(consultation.scheduledAt)}
        </span>
      </TableCell>
      <TableCell>
        <div>
          {consultation.firstName} {consultation.lastName}
        </div>
        <div className="font-mono text-xs text-muted-foreground" title="Student ID">
          {consultation.studentId}
        </div>
      </TableCell>
      <TableCell className="max-w-xs whitespace-pre-wrap break-words">{consultation.reason}</TableCell>
      <TableCell className="text-right">
        <StatusBadge status={consultation.status} />
      </TableCell>
    </TableRow>
  );
}
