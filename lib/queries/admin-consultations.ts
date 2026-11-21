import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type AdminConsultationPage, adminConsultationsApi } from "@/lib/api/client";
import type { AdminConsultationDTO } from "@/lib/services/consultation-dto";

// The admin list, one cached query per page. Every key carries the signed-in
// admin's ID and the page's cursor, so nothing cached for one account is
// served to another, and each page is fetched once.

export const adminConsultationKeys = {
  all: ["admin-consultations"] as const,
  /** `limit` is part of the key: the same cursor with another page size is another page. */
  page: (userId: string, cursor: string | null, limit: number) =>
    ["admin-consultations", userId, cursor, { limit }] as const,
};

/**
 * The cursor of each page to show: the first page has none, and every later
 * page starts at the `nextCursor` the page before it has now. Deriving the
 * chain (rather than storing cursors) means a refetched first page that ends
 * on a different row moves the second page with it, so no row is skipped.
 * Stops early when a page is not loaded yet or is the last one.
 */
export function cursorChain(
  pages: number,
  nextCursorAfter: (cursor: string | null) => string | null | undefined,
): (string | null)[] {
  const cursors: (string | null)[] = [null];
  while (cursors.length < pages) {
    const next = nextCursorAfter(cursors[cursors.length - 1]);
    if (!next) break;
    cursors.push(next);
  }
  return cursors;
}

/** Rows of every loaded page, in order. Pages still loading add nothing yet. */
export function flattenPages(pages: (AdminConsultationPage | undefined)[]): AdminConsultationDTO[] {
  return pages.flatMap((page) => page?.data ?? []);
}

export function useAdminConsultations(userId: string, limit: number) {
  const queryClient = useQueryClient();
  const [pages, setPages] = useState(1);

  // Reading the cache here is safe: useQueries below subscribes to every page
  // in the chain, so a change to any of them renders again and re-derives it.
  const cursors = cursorChain(
    pages,
    (cursor) =>
      queryClient.getQueryData<AdminConsultationPage>(adminConsultationKeys.page(userId, cursor, limit))
        ?.nextCursor,
  );

  const results = useQueries({
    queries: cursors.map((cursor) => ({
      queryKey: adminConsultationKeys.page(userId, cursor, limit),
      queryFn: () => adminConsultationsApi.list({ cursor: cursor ?? undefined, limit }),
    })),
  });

  const first = results[0];
  const last = results[results.length - 1];
  const failed = results.find((result) => result.isError);

  return {
    rows: flattenPages(results.map((result) => result.data)),
    /** The first page has not arrived yet. */
    isPending: first.isPending,
    /** The first failed page, if any; earlier pages stay on screen. */
    error: failed?.error ?? null,
    retry: () => failed?.refetch(),
    isRetrying: failed?.isFetching ?? false,
    /** The last loaded page has a `nextCursor`. */
    hasMore: Boolean(last.data?.nextCursor),
    isLoadingMore: results.length > 1 && last.isPending,
    loadMore: () => setPages(cursors.length + 1),
  };
}
