"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { formatDateTime, isoToLocalInput } from "@/lib/datetime";
import { useRescheduleConsultation } from "@/lib/queries/consultations";
import type { ConsultationDTO } from "@/lib/services/consultation-dto";
import {
  type RescheduleConsultationInput,
  type RescheduleFormValues,
  rescheduleFormSchema,
} from "@/lib/validation/consultation";
import { applyServerErrors } from "./server-errors";

const FIELDS = ["scheduledAt"] as const;

/** The current time as the starting value, unless it has already passed. */
function initialValue(consultation: ConsultationDTO): RescheduleFormValues {
  const future = new Date(consultation.scheduledAt).getTime() > Date.now();
  return { scheduledAt: future ? isoToLocalInput(consultation.scheduledAt) : "" };
}

export function RescheduleDialog({ userId, consultation }: { userId: string; consultation: ConsultationDTO }) {
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const reschedule = useRescheduleConsultation(userId);
  const form = useForm<RescheduleFormValues, unknown, RescheduleConsultationInput>({
    resolver: zodResolver(rescheduleFormSchema),
    defaultValues: initialValue(consultation),
  });

  const onOpenChange = (next: boolean) => {
    if (reschedule.isPending) return;
    setOpen(next);
    setFormError(null);
    if (next) form.reset(initialValue(consultation));
  };

  const onSubmit = form.handleSubmit(async (input) => {
    setFormError(null);
    try {
      await reschedule.mutateAsync({ id: consultation.id, ...input });
      toast.success(`Rescheduled to ${formatDateTime(input.scheduledAt)}`);
      setOpen(false);
    } catch (error) {
      setFormError(applyServerErrors(error, FIELDS, form.setError));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Reschedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule consultation</DialogTitle>
          <DialogDescription>
            Currently {formatDateTime(consultation.scheduledAt)}. The old time becomes free to book again.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="scheduledAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New date and time</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" min={isoToLocalInput(new Date())} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={reschedule.isPending}>
                Close
              </Button>
              <Button type="submit" disabled={reschedule.isPending}>
                {reschedule.isPending ? "Saving…" : "Reschedule"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
