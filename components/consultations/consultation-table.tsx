"use client";

import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/datetime";
import { useConsultations, useSetCompleted } from "@/lib/queries/consultations";
import type { ConsultationDTO } from "@/lib/services/consultation-dto";
import { type ConsultationStatus, allowedActions } from "@/lib/services/consultation-rules";
import { cn } from "@/lib/utils";
import { CancelDialog } from "./cancel-dialog";
import { RescheduleDialog } from "./reschedule-dialog";

const COLUMNS = 5;

export function ConsultationTable({ userId }: { userId: string }) {
  const { data, dataUpdatedAt, isPending, isError, error, refetch, isRefetching } = useConsultations(userId);

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Done</TableHead>
            <TableHead>When</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead className="text-right">Status and actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <MessageRow>Loading consultations…</MessageRow>
          ) : isError ? (
            <MessageRow>
              <span role="alert" className="text-destructive">
                {error.message}
              </span>{" "}
              <Button size="sm" variant="outline" className="ml-2" onClick={() => refetch()} disabled={isRefetching}>
                {isRefetching ? "Retrying…" : "Retry"}
              </Button>
            </MessageRow>
          ) : data.length === 0 ? (
            <MessageRow>No consultations yet. Use “Book a consultation” to make one.</MessageRow>
          ) : (
            data.map((consultation) => (
              <ConsultationRow
                key={consultation.id}
                userId={userId}
                consultation={consultation}
                // "Past" is judged against when the list was fetched, which
                // keeps rendering pure; every refetch moves it forward.
                now={dataUpdatedAt}
              />
            ))
          )}
        </TableBody>
      </Table>
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

function ConsultationRow({
  userId,
  consultation,
  now,
}: {
  userId: string;
  consultation: ConsultationDTO;
  now: number;
}) {
  const setCompleted = useSetCompleted(userId);
  const actions = allowedActions(consultation.status);
  const canToggle = actions.complete || actions.markIncomplete;
  const isPast = new Date(consultation.scheduledAt).getTime() <= now;
  const name = `${consultation.firstName} ${consultation.lastName}`;

  const toggle = (checked: boolean) =>
    setCompleted.mutate(
      { id: consultation.id, completed: checked },
      { onError: (error) => toast.error(error.message) },
    );

  return (
    <TableRow className={cn(consultation.status === "cancelled" && "text-muted-foreground")}>
      <TableCell>
        <Checkbox
          checked={consultation.status === "completed"}
          onCheckedChange={(checked) => toggle(checked === true)}
          disabled={!canToggle || setCompleted.isPending}
          aria-label={
            consultation.status === "completed" ? `Mark ${name}'s consultation incomplete` : `Mark ${name}'s consultation complete`
          }
        />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span className={cn(consultation.status === "cancelled" && "line-through")}>
          {formatDateTime(consultation.scheduledAt)}
        </span>
        {isPast && consultation.status === "scheduled" && (
          <span className="ml-2 text-xs text-muted-foreground">(past)</span>
        )}
      </TableCell>
      <TableCell>{name}</TableCell>
      <TableCell className="max-w-xs whitespace-pre-wrap break-words">{consultation.reason}</TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          <StatusBadge status={consultation.status} />
          {actions.reschedule && <RescheduleDialog userId={userId} consultation={consultation} />}
          {actions.cancel && <CancelDialog userId={userId} consultation={consultation} />}
        </div>
      </TableCell>
    </TableRow>
  );
}

const STATUS: Record<ConsultationStatus, { label: string; className: string }> = {
  scheduled: { label: "Scheduled", className: "border-blue-500/40 text-blue-700 dark:text-blue-300" },
  completed: { label: "Completed", className: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300" },
  cancelled: { label: "Cancelled", className: "text-muted-foreground" },
};

function StatusBadge({ status }: { status: ConsultationStatus }) {
  return (
    <Badge variant="outline" className={STATUS[status].className}>
      {STATUS[status].label}
    </Badge>
  );
}
