"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { isoToLocalInput } from "@/lib/datetime";
import { useCreateConsultation } from "@/lib/queries/consultations";
import {
  type BookingFormValues,
  type CreateConsultationInput,
  bookingFormSchema,
} from "@/lib/validation/consultation";
import { applyServerErrors } from "./server-errors";

const EMPTY: BookingFormValues = { firstName: "", lastName: "", reason: "", scheduledAt: "" };
const FIELDS = ["firstName", "lastName", "reason", "scheduledAt"] as const;

export function BookingDialog({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateConsultation(userId);
  const form = useForm<BookingFormValues, unknown, CreateConsultationInput>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: EMPTY,
  });

  const close = () => {
    setOpen(false);
    form.reset(EMPTY);
    setFormError(null);
  };

  // The dialog stays open while a booking is being sent.
  const onOpenChange = (next: boolean) => {
    if (create.isPending) return;
    if (next) setOpen(true);
    else close();
  };

  const onSubmit = form.handleSubmit(async (input) => {
    setFormError(null);
    try {
      await create.mutateAsync(input);
      toast.success("Consultation booked");
      close();
    } catch (error) {
      setFormError(applyServerErrors(error, FIELDS, form.setError));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Book a consultation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Book a consultation</DialogTitle>
          <DialogDescription>Choose a time in the future. You can reschedule or cancel it later.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input autoComplete="given-name" maxLength={100} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input autoComplete="family-name" maxLength={100} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea rows={3} maxLength={1000} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="scheduledAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date and time</FormLabel>
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
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
                Close
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Booking…" : "Book"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
