import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { consultationsApi } from "@/lib/api/client";
import type { ConsultationDTO } from "@/lib/services/consultation-dto";
import type {
  CreateConsultationInput,
  RescheduleConsultationInput,
} from "@/lib/validation/consultation";

// TanStack Query hooks for the student dashboard. Every key carries the
// signed-in user's ID, so one student's cached list can never be served to
// another student signing in on the same browser.

export const consultationKeys = {
  all: ["consultations"] as const,
  list: (userId: string) => ["consultations", userId] as const,
};

export function useConsultations(userId: string) {
  return useQuery({
    queryKey: consultationKeys.list(userId),
    queryFn: consultationsApi.list,
  });
}

/** After any change, refetch: the server's state always wins. */
function useRefetchList(userId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: consultationKeys.list(userId) });
}

export function useCreateConsultation(userId: string) {
  const refetch = useRefetchList(userId);
  return useMutation({
    mutationFn: (input: CreateConsultationInput) => consultationsApi.create(input),
    onSettled: refetch,
  });
}

export function useRescheduleConsultation(userId: string) {
  const refetch = useRefetchList(userId);
  return useMutation({
    mutationFn: ({ id, ...input }: RescheduleConsultationInput & { id: string }) =>
      consultationsApi.reschedule(id, input),
    onSettled: refetch,
  });
}

export function useCancelConsultation(userId: string) {
  const refetch = useRefetchList(userId);
  return useMutation({
    mutationFn: (id: string) => consultationsApi.cancel(id),
    onSettled: refetch,
  });
}

/**
 * The complete toggle. The row changes at once; on error the snapshot is put
 * back (the caller shows the API's message); either way the list is refetched.
 */
export function useSetCompleted(userId: string) {
  const queryClient = useQueryClient();
  const key = consultationKeys.list(userId);
  return useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      consultationsApi.setCompleted(id, completed),
    onMutate: async ({ id, completed }) => {
      // A refetch already in flight would overwrite the optimistic row.
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<ConsultationDTO[]>(key);
      queryClient.setQueryData<ConsultationDTO[]>(key, (rows) =>
        rows?.map((row) =>
          row.id === id ? applyCompleted(row, completed) : row,
        ),
      );
      return { snapshot };
    },
    onError: (_error, _vars, context) => {
      if (context?.snapshot) queryClient.setQueryData(key, context.snapshot);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** The optimistic row: only scheduled ↔ completed changes; cancelled stays as it is. */
export function applyCompleted(row: ConsultationDTO, completed: boolean): ConsultationDTO {
  if (row.status === "cancelled") return row;
  return { ...row, status: completed ? "completed" : "scheduled" };
}
