"use server";

import { z } from "zod";

import { tenantIdSchema } from "./auth-input";
import { assertSameOrigin } from "./csrf";
import type { ContentView } from "./view-events";
import { contentViewKinds, recordContentView } from "./view-events";

const contentViewSchema = z.object({
  kind: z.enum(contentViewKinds),
  publicId: z.string().trim().min(1).max(64),
  tenantId: tenantIdSchema,
});

/**
 * Record the soft page view for the detail page the reader has open.
 *
 * The parameter is typed for this app's own caller, and validated anyway: a
 * Server Action is a public endpoint, so the browser on the other side can
 * send whatever it likes.
 *
 * Nothing is returned and nothing is thrown. The page does not change on
 * success, so it must not change on failure either — an invalid input is
 * dropped rather than reported, because there is no reader mistake to correct.
 */
export const recordContentViewAction = async (
  view: ContentView
): Promise<void> => {
  await assertSameOrigin();
  const parsed = contentViewSchema.safeParse(view);
  if (!parsed.success) {
    return;
  }
  await recordContentView(parsed.data);
};
