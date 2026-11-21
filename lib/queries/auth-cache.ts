// When the query cache must be dropped. Pure, so it is unit-tested without a
// browser. Clearing on sign-out or a different user keeps one student's data
// from ever reaching the next person on a shared computer; a token refresh
// for the same user keeps the cache, so the list does not reload for no reason.

/**
 * `previous` is the user ID last seen (undefined before the first auth
 * event, null when signed out); `next` is the user ID in this event's session.
 */
export function shouldClearCache(
  previous: string | null | undefined,
  event: string,
  next: string | null,
): boolean {
  if (event === "SIGNED_OUT") return true;
  if (previous === undefined) return false; // first event: nothing cached for anyone else yet
  return previous !== next;
}
