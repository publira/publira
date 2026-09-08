import { randomUUID } from "node:crypto";

/**
 * A comment body no other attempt has posted.
 *
 * The API refuses the same body from the same reader on the same episode for a
 * window, which is what stops a comment box from being a flood channel. The
 * counters behind that refusal live in Redis rather than in the database, so
 * resetting the scenario rows does not reset them: a retry, or a second run of
 * the suite inside the window, would re-send text its earlier attempt already
 * posted and be answered by the guard instead of by the behaviour under test.
 *
 * Call it inside the test rather than once per module, so a retry gets its own
 * body whether or not it runs in a fresh worker.
 */
export const uniqueCommentBody = (text: string): string =>
  `${text} [${randomUUID().slice(0, 8)}]`;
