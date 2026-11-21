import "server-only";

import { InvalidState, NotFound, ValidationError, fromDbError, parseId } from "@/lib/api/errors";
import type { Db } from "@/lib/supabase/server";
import {
  CONSULTATION_COLUMNS,
  type AdminConsultationDTO,
  type ConsultationDTO,
  type ConsultationRecord,
  toAdminConsultationDTO,
  toConsultationDTO,
} from "@/lib/services/consultation-dto";
import {
  type Decision,
  decideCancel,
  decideReschedule,
  decideSetCompleted,
  statusOf,
} from "@/lib/services/consultation-rules";
import { decodeCursor, encodeCursor } from "@/lib/services/cursor";
import type {
  AdminListQuery,
  CreateConsultationInput,
  UpdateConsultationInput,
} from "@/lib/validation/consultation";

// Use cases. Each takes the caller's session client and user ID, so every
// query runs under that user's RLS policies; tests can pass a client signed in
// as any role. Services return DTOs, never raw rows, and throw typed errors.

/** The caller's own consultations by consultation time, cancelled ones included. */
export async function listConsultations(db: Db, userId: string): Promise<ConsultationDTO[]> {
  // Filter by student_id explicitly rather than relying on RLS alone; it also
  // matches the (student_id, scheduled_at, id) index.
  const { data, error } = await db
    .from("consultations")
    .select(CONSULTATION_COLUMNS)
    .eq("student_id", userId)
    .order("scheduled_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw fromDbError(error);
  return data.map(toConsultationDTO);
}

/** Books a consultation. It starts as scheduled; the database sets student_id. */
export async function createConsultation(
  db: Db,
  userId: string,
  input: CreateConsultationInput,
): Promise<ConsultationDTO> {
  const { data, error } = await db
    .from("consultations")
    .insert({
      first_name: input.firstName,
      last_name: input.lastName,
      reason: input.reason,
      scheduled_at: input.scheduledAt,
    })
    .select(CONSULTATION_COLUMNS)
    .single();
  if (error) throw fromDbError(error);
  // student_id comes from the column default auth.uid(); it must be the caller.
  if (data.student_id !== userId) throw new Error("Booking owner does not match the session user");
  return toConsultationDTO(data);
}

/** `{ completed }` sets a target state; `{ scheduledAt }` reschedules. */
export async function updateConsultation(
  db: Db,
  userId: string,
  id: string,
  input: UpdateConsultationInput,
): Promise<ConsultationDTO> {
  const row = await getOwn(db, userId, id);
  const status = statusOf(row);

  if ("scheduledAt" in input) {
    apply(decideReschedule(status, new Date(input.scheduledAt), new Date()));
    return toConsultationDTO(await write(db, userId, id, { scheduled_at: input.scheduledAt }));
  }

  // A repeat of the current state returns the row without writing, so
  // completed_at and updated_at keep their values.
  if (!apply(decideSetCompleted(status, input.completed))) return toConsultationDTO(row);
  // The database replaces this time with now(); it only signals "complete".
  const completedAt = input.completed ? new Date().toISOString() : null;
  return toConsultationDTO(await write(db, userId, id, { completed_at: completedAt }));
}

/** Cancels a scheduled booking. Soft: the row stays, with cancelled_at set. */
export async function cancelConsultation(db: Db, userId: string, id: string): Promise<ConsultationDTO> {
  const row = await getOwn(db, userId, id);
  apply(decideCancel(statusOf(row)));
  // The database replaces this time with now().
  return toConsultationDTO(await write(db, userId, id, { cancelled_at: new Date().toISOString() }));
}

export type AdminPage = { data: AdminConsultationDTO[]; nextCursor: string | null };

/**
 * Every consultation, ordered by (scheduled_at, id), one page at a time. The
 * admin select policy decides what is visible; the route's withAdmin decides
 * who may call this.
 */
export async function listAllConsultations(db: Db, query: AdminListQuery): Promise<AdminPage> {
  let request = db
    .from("consultations")
    .select(CONSULTATION_COLUMNS)
    .order("scheduled_at", { ascending: true })
    .order("id", { ascending: true })
    // One extra row tells whether another page exists.
    .limit(query.limit + 1);

  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    if (!cursor) throw new ValidationError("Invalid input", { cursor: ["Invalid cursor"] });
    // Rows strictly after (scheduled_at, id). Both values are validated: a
    // timestamp and a UUID. The timestamp is quoted because it holds ':' and '+'.
    const at = `"${cursor.scheduledAt}"`;
    request = request.or(`scheduled_at.gt.${at},and(scheduled_at.eq.${at},id.gt.${cursor.id})`);
  }

  const { data, error } = await request;
  if (error) throw fromDbError(error);

  const page = data.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor =
    data.length > query.limit && last ? encodeCursor({ scheduledAt: last.scheduled_at, id: last.id }) : null;
  return { data: page.map(toAdminConsultationDTO), nextCursor };
}

/** The caller's own row; someone else's row is a 404, so its existence is not revealed. */
async function getOwn(db: Db, userId: string, id: string): Promise<ConsultationRecord> {
  const { data, error } = await db
    .from("consultations")
    .select(CONSULTATION_COLUMNS)
    .eq("id", parseId(id))
    .eq("student_id", userId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw new NotFound();
  return data;
}

type Change = { scheduled_at?: string; completed_at?: string | null; cancelled_at?: string };

/**
 * Sends one change. The trigger checks it again, so a race with another
 * request (say, two tabs) ends in a 422 rather than an illegal row. Zero rows
 * updated (the row is gone, or RLS hides it) is a 404.
 */
async function write(db: Db, userId: string, id: string, change: Change): Promise<ConsultationRecord> {
  const { data, error } = await db
    .from("consultations")
    .update(change)
    .eq("id", id)
    .eq("student_id", userId)
    .select(CONSULTATION_COLUMNS)
    .single();
  if (error) throw fromDbError(error);
  return data;
}

/** Throws for a rejected decision; returns true when a write is needed. */
function apply(decision: Decision): boolean {
  if (decision.kind === "reject") {
    if (decision.reason === "not_future") {
      throw new ValidationError("Invalid input", { scheduledAt: [decision.message] });
    }
    throw new InvalidState(decision.message);
  }
  return decision.kind === "write";
}
