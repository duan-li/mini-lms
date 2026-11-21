"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/datetime";
import { useCancelConsultation } from "@/lib/queries/consultations";
import type { ConsultationDTO } from "@/lib/services/consultation-dto";

/** Cancel asks to confirm: it is final, unlike complete. */
export function CancelDialog({ userId, consultation }: { userId: string; consultation: ConsultationDTO }) {
  const [open, setOpen] = useState(false);
  const cancel = useCancelConsultation(userId);

  const onConfirm = async () => {
    try {
      await cancel.mutateAsync(consultation.id);
      toast.success("Consultation cancelled");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel the consultation.");
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !cancel.isPending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
          Cancel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this consultation?</DialogTitle>
          <DialogDescription>
            {formatDateTime(consultation.scheduledAt)}: {consultation.reason}. A cancelled consultation stays in your
            list and cannot be changed again. The time becomes free to book.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={cancel.isPending}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={cancel.isPending}>
            {cancel.isPending ? "Cancelling…" : "Cancel consultation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
