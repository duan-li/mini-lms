// Typed fetch helpers for the UI. Every read and write from the browser goes
// through the Route Handlers, so the API's checks and RLS always apply.
// Type-only imports keep server code out of the client bundle.

import type { ErrorBody, FieldErrors } from "@/lib/api/errors";
import type { ConsultationDTO } from "@/lib/services/consultation-dto";
import type {
  CreateConsultationInput,
  RescheduleConsultationInput,
} from "@/lib/validation/consultation";

/** A failed API call: the status and the `{ error }` body the API sent. */
export class ApiClientError extends Error {
  override name = "ApiClientError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: FieldErrors,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: { method: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(0, "network_error", "Could not reach the server. Check your connection and try again.");
  }

  const body = (await res.json().catch(() => null)) as ({ data: T } & Partial<ErrorBody>) | null;
  if (!res.ok || !body || !("data" in body)) {
    const error = body?.error;
    throw new ApiClientError(
      res.status,
      error?.code ?? "unknown_error",
      error?.message ?? "Something went wrong. Please try again.",
      error?.fields,
    );
  }
  return body.data;
}

export const consultationsApi = {
  list: () => request<ConsultationDTO[]>("/api/consultations"),

  create: (input: CreateConsultationInput) =>
    request<ConsultationDTO>("/api/consultations", { method: "POST", body: input }),

  setCompleted: (id: string, completed: boolean) =>
    request<ConsultationDTO>(`/api/consultations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { completed },
    }),

  reschedule: (id: string, input: RescheduleConsultationInput) =>
    request<ConsultationDTO>(`/api/consultations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    }),

  cancel: (id: string) =>
    request<ConsultationDTO>(`/api/consultations/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
};
