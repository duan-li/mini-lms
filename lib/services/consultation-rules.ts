// Pure state rules. The same rules are enforced again by the
// consultations_enforce_rules trigger, so a request that slips past these
// (for example, a race between two tabs) still cannot make an illegal change.
//
//   scheduled --complete--> completed --mark incomplete--> scheduled
//   scheduled --cancel----> cancelled (final)
//   scheduled --reschedule (future time only)--> scheduled
//
// No imports: the UI uses allowedActions() to show only legal buttons.

export type ConsultationStatus = "scheduled" | "completed" | "cancelled";

export type StateTimestamps = {
  completed_at: string | null;
  cancelled_at: string | null;
};

export function statusOf(row: StateTimestamps): ConsultationStatus {
  if (row.cancelled_at) return "cancelled";
  if (row.completed_at) return "completed";
  return "scheduled";
}

/**
 * What to do with a request:
 * - `write`: a legal change, send it to the database
 * - `noop`: the booking is already in the requested state; return it unchanged
 * - `reject`: illegal; `reason` says which HTTP error it becomes
 */
export type Decision =
  | { kind: "write" }
  | { kind: "noop" }
  | { kind: "reject"; reason: "invalid_state" | "not_future"; message: string };

const write: Decision = { kind: "write" };
const noop: Decision = { kind: "noop" };
const invalidState = (message: string): Decision => ({ kind: "reject", reason: "invalid_state", message });

/**
 * `{ completed }` names a target state, so a repeat is a no-op, not an error.
 * Past bookings may be completed or marked incomplete: no time check.
 */
export function decideSetCompleted(status: ConsultationStatus, completed: boolean): Decision {
  if (status === "cancelled") return invalidState("A cancelled consultation cannot change");
  return (status === "completed") === completed ? noop : write;
}

/** Only a scheduled booking moves, and only to a future time. */
export function decideReschedule(status: ConsultationStatus, scheduledAt: Date, now: Date): Decision {
  if (status !== "scheduled") return invalidState("Only a scheduled consultation can be rescheduled");
  if (scheduledAt.getTime() <= now.getTime()) {
    return { kind: "reject", reason: "not_future", message: "Consultation time must be in the future" };
  }
  return write;
}

/** Cancel is an action, not a target state: a second cancel is rejected. */
export function decideCancel(status: ConsultationStatus): Decision {
  if (status !== "scheduled") return invalidState("Only a scheduled consultation can be cancelled");
  return write;
}

export type AllowedActions = {
  complete: boolean;
  markIncomplete: boolean;
  reschedule: boolean;
  cancel: boolean;
};

/** The actions the UI may offer for a booking in this state. */
export function allowedActions(status: ConsultationStatus): AllowedActions {
  return {
    complete: status === "scheduled",
    markIncomplete: status === "completed",
    reschedule: status === "scheduled",
    cancel: status === "scheduled",
  };
}
