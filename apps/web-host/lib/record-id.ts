import { z } from "zod";

/**
 * A record's internal ID, as a form or a Route Handler path carries it.
 * `guid` checks the shape only: the API accepts any UUID, and seeded IDs are
 * not RFC-versioned.
 */
export const recordIdSchema = z.string().trim().pipe(z.guid());
