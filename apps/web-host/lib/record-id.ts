import { z } from "zod";

/** A record's internal ID, as a form or a Route Handler path carries it. */
export const recordIdSchema = z.string().trim().pipe(z.uuid());
