import { Badge } from "@/components/ui/badge";
import type { ConsultationStatus } from "@/lib/services/consultation-rules";

const STATUS: Record<ConsultationStatus, { label: string; className: string }> = {
  scheduled: { label: "Scheduled", className: "border-blue-500/40 text-blue-700 dark:text-blue-300" },
  completed: { label: "Completed", className: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300" },
  cancelled: { label: "Cancelled", className: "text-muted-foreground" },
};

/** The consultation's state, as shown in the student and admin tables. */
export function StatusBadge({ status }: { status: ConsultationStatus }) {
  return (
    <Badge variant="outline" className={STATUS[status].className}>
      {STATUS[status].label}
    </Badge>
  );
}
