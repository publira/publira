"use client";

import { catchError } from "next/error";

/**
 * The boundary the queue badge renders behind.
 *
 * `countPendingComments` rethrows an unclassifiable error rather than
 * swallowing it, the way every read in this console does, and the badge sits
 * in the sidebar of the protected layout — above every page-level boundary. So
 * without one of its own, an `internal` from the count RPC would take the
 * whole console shell down over a number.
 *
 * The fallback is nothing at all: an absent badge is what an empty queue looks
 * like too, and the moderation screen is where the failure is actually
 * reported. `<Suspense fallback={null}>` inside it covers the wait; a
 * suspension is not a rejection, and only this catches the rejection.
 */
export const PendingCommentBadgeErrorCatch = catchError(() => null);
